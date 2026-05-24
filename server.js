require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── GROQ AI SETUP ──
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────
// POST /api/generate
// Generates a personalized AI reply for a review
// ─────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  try {
    const {
      reviewText,
      reviewerName,
      rating,
      businessName = 'our business',
      tone = 'friendly'
    } = req.body;

    if (!reviewText || !reviewerName || !rating) {
      return res.status(400).json({ success: false, error: 'Missing required fields: reviewText, reviewerName, rating' });
    }

    const toneGuide = {
      friendly:     'warm, friendly, and welcoming — like talking to a friend',
      professional: 'professional, formal, and polished',
      casual:       'relaxed, casual, and fun',
      luxury:       'elegant, sophisticated, and refined'
    };

    const ratingGuide = {
      5: 'Be enthusiastic and genuinely grateful. Celebrate the positive experience.',
      4: 'Be appreciative and warm. Acknowledge what went well.',
      3: 'Be diplomatic. Thank them and subtly address any concerns without being defensive.',
      2: 'Be empathetic and apologetic. Acknowledge the issue, take responsibility, and offer to make it right.',
      1: 'Be very empathetic, apologize sincerely, take full responsibility, and offer to resolve the issue personally.'
    };

    const prompt = `You are a professional Google Review response writer for "${businessName}".

Your job: Write a personalized, genuine, human-sounding reply to the following review.

RULES:
- Use the reviewer's first name (${reviewerName}) naturally in the response
- Reference at least one specific detail from the review text
- Tone: ${toneGuide[tone] || toneGuide.friendly}
- Length: 60 to 120 words — not too short, not too long
- Star rating guidance: ${ratingGuide[rating] || ratingGuide[3]}
- End with: an invitation to return (4-5 stars) OR a direct contact offer (1-3 stars)
- Do NOT use hashtags
- Do NOT use corporate jargon
- Do NOT repeat the same phrases from the review word-for-word
- Sound like a real person who genuinely cares, not a template

REVIEW DETAILS:
- Reviewer: ${reviewerName}
- Rating: ${rating}/5 stars
- Review: "${reviewText}"

Write ONLY the response text. No quotes, no labels, no explanations. Just the reply.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.85
    });
    const reply = completion.choices[0].message.content.trim();

    res.json({ success: true, reply });

  } catch (error) {
    console.error('❌ Gemini error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate response.'
    });
  }
});

// ─────────────────────────────────────────
// POST /api/generate-bulk
// Generates replies for multiple reviews at once
// ─────────────────────────────────────────
app.post('/api/generate-bulk', async (req, res) => {
  try {
    const { reviews, businessName, tone } = req.body;

    if (!reviews || !Array.isArray(reviews)) {
      return res.status(400).json({ success: false, error: 'reviews array is required' });
    }

    const results = [];

    for (const review of reviews) {
      try {
        const response = await fetch(`http://localhost:${PORT}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...review, businessName, tone })
        });
        const data = await response.json();
        results.push({ id: review.id, ...data });
      } catch (e) {
        results.push({ id: review.id, success: false, error: e.message });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────
// GET /api/health
// Check if server is running
// ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '⭐ StarReply backend is running!',
    gemini: process.env.GEMINI_API_KEY ? '✅ API Key configured' : '❌ API Key missing'
  });
});

// ─────────────────────────────────────────
// Catch-all: serve dashboard for any unknown route
// ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(50));
  console.log('⭐  StarReply Backend — RUNNING');
  console.log('═'.repeat(50));
  console.log(`🌐  Landing page:  http://localhost:${PORT}`);
  console.log(`🔐  Login:         http://localhost:${PORT}/login.html`);
  console.log(`📊  Dashboard:     http://localhost:${PORT}/dashboard.html`);
  console.log(`🤖  AI Endpoint:   http://localhost:${PORT}/api/generate`);
  console.log(`💚  Health check:  http://localhost:${PORT}/api/health`);
  console.log('═'.repeat(50));
  console.log('✅  Groq API:', process.env.GROQ_API_KEY ? 'Connected' : '⚠️  Key missing in .env');
  console.log('═'.repeat(50) + '\n');
});
