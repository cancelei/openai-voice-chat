require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { OpenAI } = require('openai');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Configure OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Store active conversations
const conversations = new Map();
const wsConversations = new Map();
const continuousConversations = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket version route
app.get('/websocket', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'websocket-chat.html'));
});

// Continuous conversation version route
app.get('/continuous', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'continuous-chat.html'));
});

// Feature comparison route
app.get('/comparison', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'comparison.html'));
});

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  let currentSessionId = null;

  // Initialize conversation
  socket.on('initConversation', async () => {
    const sessionId = Date.now().toString();
    
    // Create new conversation context
    conversations.set(sessionId, {
      messages: [
        { role: 'system', content: 'You are a helpful, friendly assistant having a real-time voice conversation. Be concise and natural in your responses, as if you were speaking, not writing. Respond in a conversational tone.' }
      ],
      lastInteraction: Date.now()
    });
    
    currentSessionId = sessionId;
    socket.emit('conversationReady', { sessionId });
    console.log('Conversation initialized:', sessionId);
  });

  // Handle real-time audio processing
  socket.on('audioChunk', async (data) => {
    try {
      const { sessionId, audioChunk } = data;
      
      if (!sessionId || !conversations.has(sessionId)) {
        socket.emit('error', { message: 'Invalid session ID' });
        return;
      }

      // Signal that we're processing
      socket.emit('processingStatus', { status: 'processing' });
      
      // Update the conversation
      const conversation = conversations.get(sessionId);
      conversation.lastInteraction = Date.now();
      
      // OpenAI API call will go here in the full implementation
      // This is where we'll integrate with the real-time streaming API
      
      // For now, emit a dummy response as we're integrating the real API in the next step
      socket.emit('transcription', { text: "Processing your audio..." });
    } catch (error) {
      console.error('Error processing audio chunk:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // Real-time audio transcription and completion
  socket.on('finalAudio', async (data) => {
    try {
      const { sessionId, audioBlob } = data;
      
      if (!sessionId || !conversations.has(sessionId)) {
        socket.emit('error', { message: 'Invalid session ID' });
        return;
      }
      
      const conversation = conversations.get(sessionId);
      
      // Convert base64 audio to buffer
      const audioBuffer = Buffer.from(audioBlob, 'base64');
      const tempFilePath = path.join(__dirname, `temp_audio_${sessionId}.wav`);
      
      // Save temporarily
      fs.writeFileSync(tempFilePath, audioBuffer);
      const audioFile = fs.createReadStream(tempFilePath);
      
      // Transcribe audio with Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
      });
      
      // Clean up temp file
      fs.unlinkSync(tempFilePath);
      
      const userText = transcription.text;
      console.log('Transcription:', userText);
      
      // Send transcription to client
      socket.emit('transcription', { text: userText });
      
      // Add to conversation history
      conversation.messages.push({ role: 'user', content: userText });
      
      // Get AI response
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: conversation.messages,
        stream: true
      });
      
      let aiResponseText = '';
      
      // Process the streaming response
      for await (const chunk of completion) {
        if (chunk.choices[0]?.delta?.content) {
          const contentChunk = chunk.choices[0].delta.content;
          aiResponseText += contentChunk;
          
          // Stream text to client as it arrives
          socket.emit('aiResponseChunk', { text: contentChunk });
        }
      }
      
      // Add the complete response to conversation history
      conversation.messages.push({ role: 'assistant', content: aiResponseText });
      
      // Generate speech from the response text
      const speechResponse = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input: aiResponseText,
        speed: 1.1,
      });
      
      // Convert the audio to base64
      const buffer = Buffer.from(await speechResponse.arrayBuffer());
      const audioBase64 = buffer.toString('base64');
      
      // Send the audio to client
      socket.emit('aiResponseAudio', { audio: audioBase64 });
      
      // Signal completion
      socket.emit('processingStatus', { status: 'ready' });
      
    } catch (error) {
      console.error('Error in final audio processing:', error);
      socket.emit('error', { message: error.message });
      socket.emit('processingStatus', { status: 'ready' });
    }
  });

  // Handle real-time TTS streaming (for future implementation)
  socket.on('startTTS', async (data) => {
    try {
      // This will handle real-time TTS once we implement the full streaming API
      // Currently OpenAI doesn't support real-time streaming TTS directly
    } catch (error) {
      console.error('Error in TTS streaming:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // End conversation
  socket.on('endConversation', ({ sessionId }) => {
    if (sessionId && conversations.has(sessionId)) {
      conversations.delete(sessionId);
      console.log('Conversation ended:', sessionId);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');
  
  // Check URL path to determine which type of connection this is
  const isContinuousMode = req.url === '/continuous-ws';
  console.log(`Connection type: ${isContinuousMode ? 'Continuous' : 'Standard'} WebSocket`);
  
  let sessionId = Date.now().toString();
  let silenceTimeout = null;
  let isProcessingAudio = false;
  let audioBuffer = Buffer.alloc(0);
  let conversationMap = isContinuousMode ? continuousConversations : wsConversations;
  
  // Initialize conversation context
  conversationMap.set(sessionId, {
    messages: [
      { role: 'system', content: 'You are a helpful, friendly assistant having a real-time voice conversation. Be concise and natural in your responses, as if you were speaking, not writing. Respond in a conversational tone.' }
    ],
    lastInteraction: Date.now(),
    isContinuous: isContinuousMode,
    isCallActive: false
  });
  
  // Send session ID to client
  ws.send(JSON.stringify({
    type: 'session',
    sessionId: sessionId,
    isContinuous: isContinuousMode
  }));
  
  // Handle incoming messages
  ws.on('message', async (message) => {
    try {
      // Parse the incoming message
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'audio':
          // Handle incoming audio data
          await handleAudioData(ws, sessionId, data.audio, conversationMap);
          break;
          
        case 'continuous_audio':
          // Handle continuous audio stream
          await handleContinuousAudio(ws, sessionId, data.audio, conversationMap);
          break;
          
        case 'start_call':
          // Start continuous call
          await startContinuousCall(ws, sessionId, conversationMap);
          break;
          
        case 'end_call':
          // End continuous call
          await endContinuousCall(ws, sessionId, conversationMap);
          break;
          
        case 'end':
          // End the conversation
          if (conversationMap.has(sessionId)) {
            conversationMap.delete(sessionId);
            console.log('WebSocket conversation ended:', sessionId);
          }
          break;
          
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
    }
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    
    // Clean up the conversation
    if (conversationMap.has(sessionId)) {
      conversationMap.delete(sessionId);
    }
    
    // Clear any timeouts
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
    }
  });
  
  // Start continuous call handler
  async function startContinuousCall(ws, sessionId, conversationMap) {
    if (!conversationMap.has(sessionId)) {
      throw new Error('Invalid session ID');
    }
    
    const conversation = conversationMap.get(sessionId);
    conversation.lastInteraction = Date.now();
    conversation.isCallActive = true;
    
    // Acknowledge call start
    ws.send(JSON.stringify({
      type: 'call_status',
      status: 'active',
      message: 'Call started. Listening...'
    }));
    
    console.log('Continuous call started for session:', sessionId);
  }
  
  // End continuous call handler
  async function endContinuousCall(ws, sessionId, conversationMap) {
    if (!conversationMap.has(sessionId)) {
      throw new Error('Invalid session ID');
    }
    
    const conversation = conversationMap.get(sessionId);
    conversation.lastInteraction = Date.now();
    conversation.isCallActive = false;
    
    // Clear any pending timeouts
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }
    
    // Acknowledge call end
    ws.send(JSON.stringify({
      type: 'call_status',
      status: 'ended',
      message: 'Call ended'
    }));
    
    console.log('Continuous call ended for session:', sessionId);
  }
  
  // Handle continuous audio stream
  async function handleContinuousAudio(ws, sessionId, audioData, conversationMap) {
    if (!conversationMap.has(sessionId)) {
      throw new Error('Invalid session ID');
    }
    
    const conversation = conversationMap.get(sessionId);
    
    // If call is not active or we're already processing, just return
    if (!conversation.isCallActive || isProcessingAudio) {
      return;
    }
    
    conversation.lastInteraction = Date.now();
    
    // Add the new chunk to our buffer
    const newChunk = Buffer.from(audioData, 'base64');
    audioBuffer = Buffer.concat([audioBuffer, newChunk]);
    
    // Reset the silence timeout
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
    }
    
    // Set a silence timeout to process accumulated audio after silence
    silenceTimeout = setTimeout(async () => {
      // Process the accumulated audio if we have enough data
      if (audioBuffer.length > 0 && !isProcessingAudio) {
        try {
          isProcessingAudio = true;
          
          // Create a copy of the buffer and reset the main buffer
          const audioToProcess = Buffer.from(audioBuffer);
          audioBuffer = Buffer.alloc(0);
          
          // Notify client that we're processing
          ws.send(JSON.stringify({
            type: 'status',
            status: 'processing'
          }));
          
          // Process the audio chunk (transcribe and respond)
          await processContinuousAudioChunk(ws, sessionId, audioToProcess, conversationMap);
          
        } finally {
          isProcessingAudio = false;
        }
      }
    }, 1000); // 1 second of silence before processing
  }
  
  // Process accumulated continuous audio
  async function processContinuousAudioChunk(ws, sessionId, audioData, conversationMap) {
    try {
      if (!conversationMap.has(sessionId)) {
        throw new Error('Invalid session ID');
      }
      
      const conversation = conversationMap.get(sessionId);
      
      // Save the audio buffer to a temporary file
      const tempFilePath = path.join(__dirname, `continuous_audio_${sessionId}.wav`);
      fs.writeFileSync(tempFilePath, audioData);
      const audioFile = fs.createReadStream(tempFilePath);
      
      // Transcribe audio with Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
      });
      
      // Clean up temp file
      fs.unlinkSync(tempFilePath);
      
      const userText = transcription.text.trim();
      
      // If the transcription is empty or just noise, ignore it
      if (!userText || userText.length < 2) {
        ws.send(JSON.stringify({
          type: 'status',
          status: 'ready'
        }));
        return;
      }
      
      console.log('Continuous Transcription:', userText);
      
      // Send transcription to client
      ws.send(JSON.stringify({
        type: 'transcription',
        text: userText
      }));
      
      // Add to conversation history
      conversation.messages.push({ role: 'user', content: userText });
      
      // Get AI response
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: conversation.messages,
        stream: true
      });
      
      let aiResponseText = '';
      
      // Process the streaming response
      for await (const chunk of completion) {
        if (chunk.choices[0]?.delta?.content) {
          const contentChunk = chunk.choices[0].delta.content;
          aiResponseText += contentChunk;
          
          // Stream text to client as it arrives
          ws.send(JSON.stringify({
            type: 'response_chunk',
            text: contentChunk
          }));
        }
      }
      
      // Add the complete response to conversation history
      conversation.messages.push({ role: 'assistant', content: aiResponseText });
      
      // Generate speech from the response text
      const speechResponse = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input: aiResponseText,
        speed: 1.1,
      });
      
      // Convert the audio to base64
      const buffer = Buffer.from(await speechResponse.arrayBuffer());
      const audioBase64 = buffer.toString('base64');
      
      // Send the audio to client
      ws.send(JSON.stringify({
        type: 'audio_response',
        audio: audioBase64
      }));
      
      // Notify client that we're ready for more input
      ws.send(JSON.stringify({
        type: 'status',
        status: 'ready'
      }));
      
    } catch (error) {
      console.error('Error processing continuous audio:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message
      }));
      
      // Notify client that we're ready despite the error
      ws.send(JSON.stringify({
        type: 'status',
        status: 'ready'
      }));
    }
  }
});

// Handle standard audio data from WebSocket
async function handleAudioData(ws, sessionId, audioData, conversationMap) {
  try {
    if (!conversationMap.has(sessionId)) {
      throw new Error('Invalid session ID');
    }
    
    const conversation = conversationMap.get(sessionId);
    conversation.lastInteraction = Date.now();
    
    // Notify client that we're processing
    ws.send(JSON.stringify({
      type: 'status',
      status: 'processing'
    }));
    
    // Convert audio data to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    const tempFilePath = path.join(__dirname, `ws_audio_${sessionId}.wav`);
    
    // Save temporarily
    fs.writeFileSync(tempFilePath, audioBuffer);
    const audioFile = fs.createReadStream(tempFilePath);
    
    // Transcribe audio with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
    });
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
    
    const userText = transcription.text;
    console.log('WebSocket Transcription:', userText);
    
    // Send transcription to client
    ws.send(JSON.stringify({
      type: 'transcription',
      text: userText
    }));
    
    // Add to conversation history
    conversation.messages.push({ role: 'user', content: userText });
    
    // Get AI response
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: conversation.messages,
      stream: true
    });
    
    let aiResponseText = '';
    
    // Process the streaming response
    for await (const chunk of completion) {
      if (chunk.choices[0]?.delta?.content) {
        const contentChunk = chunk.choices[0].delta.content;
        aiResponseText += contentChunk;
        
        // Stream text to client as it arrives
        ws.send(JSON.stringify({
          type: 'response_chunk',
          text: contentChunk
        }));
      }
    }
    
    // Add the complete response to conversation history
    conversation.messages.push({ role: 'assistant', content: aiResponseText });
    
    // Generate speech from the response text
    const speechResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: aiResponseText,
      speed: 1.1,
    });
    
    // Convert the audio to base64
    const buffer = Buffer.from(await speechResponse.arrayBuffer());
    const audioBase64 = buffer.toString('base64');
    
    // Send the audio to client
    ws.send(JSON.stringify({
      type: 'audio_response',
      audio: audioBase64
    }));
    
    // Notify client that we're ready for more input
    ws.send(JSON.stringify({
      type: 'status',
      status: 'ready'
    }));
    
  } catch (error) {
    console.error('Error processing WebSocket audio:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: error.message
    }));
    
    // Notify client that we're ready despite the error
    ws.send(JSON.stringify({
      type: 'status',
      status: 'ready'
    }));
  }
}

// Cleanup old conversations (run every hour)
setInterval(() => {
  const now = Date.now();
  
  // Clean up Socket.IO conversations
  for (const [sessionId, conversation] of conversations.entries()) {
    // Remove conversations inactive for more than 1 hour
    if (now - conversation.lastInteraction > 60 * 60 * 1000) {
      conversations.delete(sessionId);
      console.log('Cleaned up inactive Socket.IO conversation:', sessionId);
    }
  }
  
  // Clean up WebSocket conversations
  for (const [sessionId, conversation] of wsConversations.entries()) {
    // Remove conversations inactive for more than 1 hour
    if (now - conversation.lastInteraction > 60 * 60 * 1000) {
      wsConversations.delete(sessionId);
      console.log('Cleaned up inactive WebSocket conversation:', sessionId);
    }
  }
  
  // Clean up Continuous conversations
  for (const [sessionId, conversation] of continuousConversations.entries()) {
    // Remove conversations inactive for more than 1 hour
    if (now - conversation.lastInteraction > 60 * 60 * 1000) {
      continuousConversations.delete(sessionId);
      console.log('Cleaned up inactive Continuous conversation:', sessionId);
    }
  }
}, 60 * 60 * 1000);

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 