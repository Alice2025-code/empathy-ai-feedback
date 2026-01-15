// api/feedback.js
export default async function handler(req, res) {
  // Basic CORS so your Storyline project can call this endpoint
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST with JSON body." });
    }

  try {
    const {
      scenarioId,
      channel, // "phone" or "chat" (optional but helpful)
      memberStatement,
      learnerResponse
    } = req.body || {};

    if (!memberStatement || typeof memberStatement !== "string") {
      return res.status(400).json({ error: "Missing memberStatement (string)." });
    }
    if (!learnerResponse || typeof learnerResponse !== "string") {
      return res.status(400).json({ error: "Missing learnerResponse (string)." });
    }

    const system = `
You are an empathy coach for US health insurance customer service agents.

Evaluate the learner response against THREE criteria:
1) Empathy first: Does the learner acknowledge/name the member’s emotion BEFORE problem-solving?
2) Emotion match: Did the learner acknowledge an emotion that reasonably matches the member’s likely emotion(s) in the statement?
   - Allow close matches (e.g., "concerned" vs "worried").
   - Do NOT require perfect wording. But if the learner labels the wrong emotion (e.g., "excited" when the member is anxious), mark as not matching.
3) Offer to help: Does the learner move beyond empathy by offering help / next step (e.g., "Let me look into that," "I can help explain," "Let’s review options")?

Important rules:
- Do NOT judge insurance technical accuracy. Only judge communication behaviors above.
- Be friendly, concise, and coaching-focused.
- If learner misses any criteria: give specific feedback on what’s missing and provide 1–2 good example responses.
- If learner meets all three: give positive reinforcement and provide 1–2 alternative strong example responses.
- Examples should be short and realistic. Start examples with empathy language first, then offer help/next step.
- Return STRICT JSON only matching the schema.
`.trim();

    const user = `
ScenarioId: ${scenarioId ?? ""}
Channel: ${channel ?? ""}
Member statement: """${memberStatement}"""
Learner response: """${learnerResponse}"""
`.trim();

    // Strict JSON schema so Storyline can reliably parse/display output
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        empathy_first: { type: "boolean" },
        emotion_match: { type: "boolean" },
        offer_to_help: { type: "boolean" },

        expected_emotions: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 3
        },

        learner_emotion_language: {
          type: "string",
          description: "What emotion words/phrases the learner used (or 'none')."
        },

        feedback: {
          type: "string",
          description: "Friendly, specific coaching. Keep to 2–4 sentences."
        },

        examples: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 2
        }
      },
      required: [
        "empathy_first",
        "emotion_match",
        "offer_to_help",
        "expected_emotions",
        "learner_emotion_language",
        "feedback",
        "examples"
      ]
    };

    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.2,
        max_output_tokens: 260,
        text: {
          format: {
            type: "json_schema",
            name: "empathy_feedback_v1",
            strict: true,
            schema
          }
        }
      })
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return res.status(500).json({
        error: "OpenAI request failed",
        details: errText
      });
    }

    const data = await openaiResp.json();

    // With structured outputs, `output_text` should be the JSON string.
    const outputText =
      (data.output_text && String(data.output_text).trim()) ||
      "";

    if (!outputText) {
      return res.status(500).json({
        error: "No output_text returned from OpenAI."
      });
    }

    const parsed = JSON.parse(outputText);
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
}
