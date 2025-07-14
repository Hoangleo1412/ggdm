import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Only POST allowed' });
    return;
  }
  const { prompt } = req.body || {};

  const keyJSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!prompt || !keyJSON) {
    res.status(400).json({ error: 'Missing prompt or GOOGLE_SERVICE_ACCOUNT_JSON' });
    return;
  }

  let serviceAcc;
  try {
    serviceAcc = typeof keyJSON === "string" ? JSON.parse(keyJSON) : keyJSON;
  } catch (e) {
    res.status(500).json({ error: "Invalid service account JSON", detail: e.message });
    return;
  }

  // 1. Tạo JWT access_token
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60;
  const payload = {
    iss: serviceAcc.client_email,
    sub: serviceAcc.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    iat,
    exp,
  };
  let token;
  try {
    token = jwt.sign(payload, serviceAcc.private_key, { algorithm: "RS256" });
  } catch (e) {
    res.status(500).json({ error: "JWT sign failed", detail: e.message });
    return;
  }

  // 2. Lấy access_token từ Google
  let access_token;
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: token,
      }),
    });
    const data = await resp.json();
    access_token = data.access_token;
    if (!access_token) throw new Error("No access_token from Google");
  } catch (e) {
    res.status(500).json({ error: "Google auth failed", detail: e.message });
    return;
  }

  // 3. Build request gọi Gemini 2.5 Flash
  const project = serviceAcc.project_id;
  const location = "us-central1";
  const publisherModel = "publishers/google/models/gemini-2.5-flash";
  const apiUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/${publisherModel}:predict`;

  const body = {
    instances: [
      {
        prompt
      }
    ],
    parameters: {
      sampleCount: 1
    }
  };

  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await resp.json();
    // Extract kết quả ảnh
    const image_base64 = result?.predictions?.[0]?.bytesBase64Encoded;
    if (!image_base64) {
      res.status(200).json({ status: "fail", message: "No image generated", raw: result });
      return;
    }
    res.status(200).json({ status: "success", image_base64 });
  } catch (e) {
    res.status(500).json({ error: "Google Gemini API call failed", detail: e.message });
  }
}
