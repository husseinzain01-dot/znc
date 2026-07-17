const express = require('express');
const OpenAI = require('openai');

const router = express.Router();

let client = null;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const SYSTEM_PROMPT = `أنت مساعد ذكي متخصص في إدارة حقول الدواجن لشركة "زهور الوطن".
تساعد المستخدمين على فهم بيانات الوجبات، الهلاكات، الأوزان، الأدوية، واللقاحات.
أجب دائماً بالعربية. كن مختصراً وعملياً. إذا سألك المستخدم عن بيانات محددة وأرسلها لك قدّمها بشكل منظم.`;

// POST /api/ai/chat  { messages: [{role, content}], context?: string }
router.post('/chat', async (req, res) => {
  try {
    const { messages = [], context } = req.body || {};
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'مفتاح OpenAI غير مضبوط في .env' });
    }

    const systemContent = context
      ? `${SYSTEM_PROMPT}\n\nبيانات النظام الحالية:\n${context}`
      : SYSTEM_PROMPT;

    const completion = await getClient().chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemContent }, ...messages],
      max_tokens: 1024,
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error('ai:chat error', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
