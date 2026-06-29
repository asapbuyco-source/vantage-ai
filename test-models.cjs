const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: 'AIzaSyCar0A4ezV_gGy6k1aIhtdyGSep90Ltlrc' });

const models = ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];

async function test() {
  for (const model of models) {
    try {
      const res = await ai.models.generateContent({
        model: model,
        contents: 'Say hello in 3 words'
      });
      console.log('✅ ' + model + ':', res.text);
    } catch (e) {
      const msg = e.message.split('\n')[0];
      console.log('❌ ' + model + ':', msg.substring(0, 100));
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}
test();
