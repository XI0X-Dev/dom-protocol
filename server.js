import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit per file
});

// Serve static files
app.use(express.static(join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.GEMINI_API_KEY });
});

// Single image generation function
async function generateSingleImage(apiKey, parts, aspectRatio, imageQuality) {
  const requestBody = {
    contents: [{
      parts: parts
    }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio,
        imageSize: imageQuality
      }
    }
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`;
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  // Check for various error conditions
  if (!response.ok) {
    return { 
      success: false, 
      error: data.error?.message || 'API request failed',
      errorCode: data.error?.code,
      errorType: 'API_ERROR'
    };
  }

  // Check for safety blocks
  if (data.promptFeedback?.blockReason) {
    const blockReasons = {
      'SAFETY': 'Content blocked due to safety filters (potentially inappropriate content detected)',
      'OTHER': 'Content blocked by policy filters (try different images or rephrase prompt)',
      'BLOCKLIST': 'Content contains blocked terms',
      'PROHIBITED_CONTENT': 'Content violates usage policy'
    };
    return {
      success: false,
      error: blockReasons[data.promptFeedback.blockReason] || `Blocked: ${data.promptFeedback.blockReason}`,
      errorType: 'SAFETY_BLOCK',
      blockReason: data.promptFeedback.blockReason
    };
  }

  // Check for missing candidates
  if (!data.candidates || data.candidates.length === 0) {
    return {
      success: false,
      error: 'No image generated - request may have been filtered',
      errorType: 'NO_CANDIDATES'
    };
  }

  // Extract image from response
  const responseParts = data.candidates[0].content?.parts || [];
  let generatedImage = null;
  let responseText = '';

  for (const part of responseParts) {
    if (part.text) {
      responseText += part.text;
    }
    if (part.inlineData?.data) {
      generatedImage = {
        mimeType: part.inlineData.mimeType || 'image/png',
        data: part.inlineData.data
      };
    }
  }

  // Check if image was filtered after generation
  if (!generatedImage) {
    if (responseText.includes('violated') || responseText.includes('policy')) {
      return {
        success: false,
        error: 'Generated image was filtered due to policy violation',
        errorType: 'IMAGE_FILTERED',
        text: responseText
      };
    }
    return {
      success: false,
      error: 'No image in response',
      errorType: 'NO_IMAGE',
      text: responseText
    };
  }

  return {
    success: true,
    image: generatedImage,
    text: responseText
  };
}

// Main batch generation endpoint
app.post('/api/generate-batch', upload.fields([
  { name: 'faceRef1', maxCount: 1 },
  { name: 'faceRef2', maxCount: 1 },
  { name: 'targetImages', maxCount: 10 }
]), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const { aspectRatio = '9:16', imageQuality = '2K', prompt } = req.body;
    
    const faceRef1 = req.files?.faceRef1?.[0];
    const faceRef2 = req.files?.faceRef2?.[0];
    const targetImages = req.files?.targetImages || [];

    if (!faceRef1 || targetImages.length === 0) {
      return res.status(400).json({ 
        error: 'At least one face reference and one target image are required' 
      });
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Batch request: ${targetImages.length} target image(s)`);
// Process images sequentially to avoid memory issues
    console.log(`\nProcessing ${targetImages.length} images sequentially...`);

    const results = [];
    for (let i = 0; i < targetImages.length; i++) {
      const targetImage = targetImages[i];
      
      const parts = [];
      parts.push({ text: finalPrompt });
      
      parts.push({
        inline_data: {
          mime_type: faceRef1.mimetype,
          data: faceRef1.buffer.toString('base64')
        }
      });

      if (faceRef2) {
        parts.push({
          inline_data: {
            mime_type: faceRef2.mimetype,
            data: faceRef2.buffer.toString('base64')
          }
        });
      }

      parts.push({
        inline_data: {
          mime_type: targetImage.mimetype,
          data: targetImage.buffer.toString('base64')
        }
      });

      try {
        const result = await generateSingleImage(apiKey, parts, aspectRatio, imageQuality);
        const status = result.success ? '✓ Success' : `✗ Failed: ${result.error}`;
        console.log(`  [${i + 1}] ${targetImage.originalname}: ${status}`);
        results.push({
          index: i,
          filename: targetImage.originalname,
          ...result
        });
      } catch (err) {
        console.log(`  [${i + 1}] ${targetImage.originalname}: ✗ Error: ${err.message}`);
        results.push({
          index: i,
          filename: targetImage.originalname,
          success: false,
          error: err.message,
          errorType: 'EXCEPTION'
        });
      }
    }
            ...result
          };
        })
        .catch(err => {
          console.log(`  [${i + 1}] ${targetImage.originalname}: ✗ Error: ${err.message}`);
          return {
            index: i,
            filename: targetImage.originalname,
            success: false,
            error: err.message,
            errorType: 'EXCEPTION'
          };
        });
    });

    // Wait for ALL to complete simultaneously
    const results = await Promise.all(promises);

    const successful = results.filter(r => r.success).length;
    console.log(`\nBatch complete: ${successful}/${targetImages.length} successful`);

    res.json({
      success: true,
      total: targetImages.length,
      successful: successful,
      failed: targetImages.length - successful,
      results: results
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message 
    });
  }
});

// Keep old single endpoint for backwards compatibility
app.post('/api/generate', upload.fields([
  { name: 'faceRef1', maxCount: 1 },
  { name: 'faceRef2', maxCount: 1 },
  { name: 'targetImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const { aspectRatio = '9:16', imageQuality = '2K', prompt } = req.body;
    
    const faceRef1 = req.files?.faceRef1?.[0];
    const faceRef2 = req.files?.faceRef2?.[0];
    const targetImage = req.files?.targetImage?.[0];

    if (!faceRef1 || !targetImage) {
      return res.status(400).json({ 
        error: 'At least one face reference and a target image are required' 
      });
    }

    console.log('\nProcessing single request...');

    const defaultPrompt = `Recreate this target image (the last image provided) with the person from the face reference image(s) (the first image(s) provided). 
The output should show the person from the face references in exactly the same pose, clothing, setting, expression, and lighting as shown in the target image.
Maintain the identity and facial features from the reference photos while perfectly matching everything else from the target image.
This is for creative/artistic purposes.`;

    const finalPrompt = prompt?.trim() || defaultPrompt;

    const parts = [];
    parts.push({ text: finalPrompt });
    
    parts.push({
      inline_data: {
        mime_type: faceRef1.mimetype,
        data: faceRef1.buffer.toString('base64')
      }
    });

    if (faceRef2) {
      parts.push({
        inline_data: {
          mime_type: faceRef2.mimetype,
          data: faceRef2.buffer.toString('base64')
        }
      });
    }

    parts.push({
      inline_data: {
        mime_type: targetImage.mimetype,
        data: targetImage.buffer.toString('base64')
      }
    });

    const result = await generateSingleImage(apiKey, parts, aspectRatio, imageQuality);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message 
    });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API Key configured: ${!!process.env.GEMINI_API_KEY}`);
});
