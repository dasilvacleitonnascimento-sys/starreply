require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const { Resend } = require('resend');
const stripe = require('stripe');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── RESEND SETUP ──
const resend = new Resend(process.env.RESEND_API_KEY);

// ── STRIPE SETUP ──
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// ── MIDDLEWARE ──
// IMPORTANT: webhook needs raw body, must come before express.json()
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── GROQ AI SETUP ──
let groq = null;
function getGroq() {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in Railway Variables');
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

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

    const completion = await getGroq().chat.completions.create({
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
// ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '⭐ StarReply backend is running!' });
});

// ─────────────────────────────────────────
// FUNCTION: Send welcome email via Resend
// ─────────────────────────────────────────
async function sendWelcomeEmail(customerEmail, customerName, planName, planPrice) {
  const firstName = customerName ? customerName.split(' ')[0] : 'there';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07090f;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">

    <!-- HEADER -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:28px;font-weight:800;color:#f1f5f9;">
        ⭐ Star<span style="color:#f59e0b;">Reply</span>
      </div>
    </div>

    <!-- CARD -->
    <div style="background:#0d1117;border:1px solid #1e2535;border-radius:16px;padding:40px;">

      <div style="font-size:32px;margin-bottom:16px;">🎉</div>
      <h1 style="color:#f1f5f9;font-size:24px;font-weight:800;margin:0 0 8px;">
        Welcome to StarReply, ${firstName}!
      </h1>
      <p style="color:#8b99b5;font-size:15px;margin:0 0 28px;line-height:1.6;">
        You're now on the <strong style="color:#f59e0b;">${planName} plan</strong> —
        your Google Reviews will never go unanswered again.
      </p>

      <!-- DIVIDER -->
      <div style="height:1px;background:#1e2535;margin-bottom:28px;"></div>

      <!-- STEPS -->
      <p style="color:#f1f5f9;font-weight:700;font-size:14px;margin:0 0 16px;text-transform:uppercase;letter-spacing:1px;">
        Your next steps:
      </p>

      <div style="margin-bottom:16px;display:flex;align-items:flex-start;">
        <div style="background:rgba(245,158,11,0.15);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#f59e0b;font-size:14px;flex-shrink:0;margin-right:14px;padding:8px;box-sizing:border-box;">1</div>
        <div>
          <div style="color:#f1f5f9;font-weight:600;font-size:14px;margin-bottom:2px;">Reply to this email</div>
          <div style="color:#8b99b5;font-size:13px;">Tell us your business name and Google Business URL so we can set up your account.</div>
        </div>
      </div>

      <div style="margin-bottom:16px;display:flex;align-items:flex-start;">
        <div style="background:rgba(245,158,11,0.15);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#f59e0b;font-size:14px;flex-shrink:0;margin-right:14px;padding:8px;box-sizing:border-box;">2</div>
        <div>
          <div style="color:#f1f5f9;font-weight:600;font-size:14px;margin-bottom:2px;">We configure everything for you</div>
          <div style="color:#8b99b5;font-size:13px;">Our team connects your Google Business Profile and sets up your AI response style within 24 hours.</div>
        </div>
      </div>

      <div style="margin-bottom:28px;display:flex;align-items:flex-start;">
        <div style="background:rgba(34,197,94,0.15);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#22c55e;font-size:14px;flex-shrink:0;margin-right:14px;padding:8px;box-sizing:border-box;">✓</div>
        <div>
          <div style="color:#f1f5f9;font-weight:600;font-size:14px;margin-bottom:2px;">StarReply goes live</div>
          <div style="color:#8b99b5;font-size:13px;">Every new Google Review gets a personalized AI response automatically. You don't have to do anything.</div>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;">
        <a href="mailto:dasilvacleitonnascimento@gmail.com?subject=StarReply Setup - ${planName}&body=Hi! I just signed up for StarReply. My business name is: [YOUR BUSINESS NAME] and my Google Business URL is: [YOUR GOOGLE BUSINESS URL]"
           style="display:inline-block;background:#f59e0b;color:#0a0e1a;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;">
          Reply to get started →
        </a>
      </div>

    </div>

    <!-- FOOTER -->
    <div style="text-align:center;margin-top:24px;color:#8b99b5;font-size:12px;">
      <p>You subscribed to <strong style="color:#f59e0b;">StarReply ${planName}</strong> at ${planPrice}/month</p>
      <p style="margin-top:4px;">Questions? Reply to this email anytime.</p>
      <p style="margin-top:4px;">© 2026 StarReply · <a href="https://starreply.vercel.app" style="color:#8b99b5;">starreply.vercel.app</a></p>
    </div>

  </div>
</body>
</html>`;

  try {
    const result = await resend.emails.send({
      from:    'StarReply <onboarding@resend.dev>',
      to:      customerEmail,
      subject: `🎉 Welcome to StarReply, ${firstName}! Here's how to get started`,
      html
    });
    console.log('✅ Welcome email sent to:', customerEmail, result);
    return { success: true };
  } catch (err) {
    console.error('❌ Email error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────
// POST /webhook/stripe
// Receives Stripe events when someone pays
// ─────────────────────────────────────────
app.post('/webhook/stripe', async (req, res) => {
  let event;

  try {
    if (STRIPE_WEBHOOK_SECRET) {
      const stripeClient = stripe(STRIPE_SECRET);
      event = stripeClient.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET
      );
    } else {
      // No secret yet — parse directly (for testing only)
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ── Handle checkout completed ──
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email || session.customer_email;
    const customerName  = session.customer_details?.name  || 'Customer';
    const amountTotal   = session.amount_total;

    // Determine plan from amount
    let planName  = 'Starter';
    let planPrice = '$29';
    if (amountTotal >= 12900) { planName = 'Agency';       planPrice = '$129'; }
    else if (amountTotal >= 5900) { planName = 'Professional'; planPrice = '$59';  }

    console.log(`💳 New payment! ${customerName} (${customerEmail}) → ${planName} ${planPrice}`);

    if (customerEmail) {
      await sendWelcomeEmail(customerEmail, customerName, planName, planPrice);
    }

    // Also notify you
    await resend.emails.send({
      from:    'StarReply <onboarding@resend.dev>',
      to:      'dasilvacleitonnascimento@gmail.com',
      subject: `💰 New StarReply customer: ${customerName} — ${planName} ${planPrice}/mo`,
      html:    `<p><strong>New customer paid!</strong></p>
                <p>Name: ${customerName}<br>
                Email: ${customerEmail}<br>
                Plan: ${planName} (${planPrice}/month)</p>
                <p>Reply to them to complete setup!</p>`
    });
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────
// POST /api/test-email  (for testing only)
// ─────────────────────────────────────────
app.post('/api/test-email', async (req, res) => {
  const { email, name, plan } = req.body;
  const result = await sendWelcomeEmail(
    email || 'dasilvacleitonnascimento@gmail.com',
    name  || 'Test User',
    plan  || 'Professional',
    plan === 'Agency' ? '$129' : plan === 'Starter' ? '$29' : '$59'
  );
  res.json(result);
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
  console.log('✅  Groq API: Connected');
  console.log('═'.repeat(50) + '\n');
});
