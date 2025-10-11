// Vercel Serverless Function to securely call Hume API
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Get API keys from environment variables (set in Vercel dashboard)
    const HUME_API_KEY = process.env.HUME_API_KEY;
    const HUME_SECRET_KEY = process.env.HUME_SECRET_KEY;

    if (!HUME_API_KEY || !HUME_SECRET_KEY) {
      console.error('Missing Hume API credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Convert base64 to Buffer
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Create form data for Hume API
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', buffer, {
      filename: 'frame.jpg',
      contentType: 'image/jpeg'
    });
    form.append('models', JSON.stringify({ face: {} }));

    // Call Hume API
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.hume.ai/v0/batch/jobs', {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': HUME_API_KEY,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Hume API Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: 'Hume API error',
        details: errorText 
      });
    }

    const data = await response.json();

    // Extract emotion data from Hume response
    // Note: Hume batch API returns a job ID, not immediate results
    // For real-time, you'd need to use their WebSocket streaming API
    
    return res.status(200).json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}