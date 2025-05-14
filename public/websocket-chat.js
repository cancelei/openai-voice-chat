document.addEventListener('DOMContentLoaded', () => {
  const recordButton = document.getElementById('recordButton');
  const statusElement = document.getElementById('status');
  const conversationContainer = document.getElementById('conversation-container');
  const audioLevelBar = document.getElementById('audioLevelBar');
  
  // WebSocket connection variables
  let ws = null;
  let sessionId = null;
  
  // Audio streaming variables
  let mediaRecorder = null;
  let audioContext = null;
  let analyser = null;
  let microphone = null;
  let audioChunks = [];
  let isRecording = false;
  let isProcessing = false;
  
  // Audio processor for real-time audio level display
  let audioProcessor = null;
  
  // Streaming status information
  const statusMessages = {
    IDLE: 'Ready to start conversation',
    CONNECTING: 'Connecting to server...',
    RECORDING: 'Listening...',
    PROCESSING: 'Processing your message...',
    RESPONDING: 'AI is responding...',
    ERROR: 'Error: '
  };
  
  // Initialize WebSocket connection
  const initWebSocket = () => {
    // Use secure WebSocket if page is served over HTTPS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connection established');
      updateStatus(statusMessages.IDLE);
    };
    
    ws.onclose = () => {
      console.log('WebSocket connection closed');
      updateStatus(statusMessages.ERROR + 'Connection closed');
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateStatus(statusMessages.ERROR + 'Connection error');
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'session':
          // Session ID received from server
          sessionId = message.sessionId;
          console.log('Conversation ready with session ID:', sessionId);
          recordButton.disabled = false;
          break;
          
        case 'status':
          // Status update from server
          if (message.status === 'processing') {
            isProcessing = true;
            updateStatus(statusMessages.PROCESSING);
          } else if (message.status === 'ready') {
            isProcessing = false;
            recordButton.disabled = false;
            updateStatus(statusMessages.IDLE);
          }
          break;
          
        case 'transcription':
          // Transcribed text received from server
          addMessage(message.text, 'user');
          break;
          
        case 'response_chunk':
          // AI response chunk received from server
          handleResponseChunk(message.text);
          break;
          
        case 'audio_response':
          // Audio response received from server
          handleAudioResponse(message.audio);
          break;
          
        case 'error':
          // Error message received from server
          console.error('Server error:', message.message);
          updateStatus(statusMessages.ERROR + message.message);
          addMessage(`Error: ${message.message}`, 'ai');
          isProcessing = false;
          recordButton.disabled = false;
          break;
          
        default:
          console.warn('Unknown message type:', message.type);
      }
    };
  };
  
  // Handle AI response chunks
  let currentAIResponse = '';
  let aiMessageElement = null;
  
  const handleResponseChunk = (text) => {
    if (!aiMessageElement) {
      // Create a new message element for the AI response
      aiMessageElement = document.createElement('div');
      aiMessageElement.className = 'message ai-message';
      conversationContainer.appendChild(aiMessageElement);
      conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
    
    // Append the chunk to the current response
    currentAIResponse += text;
    aiMessageElement.textContent = currentAIResponse;
    conversationContainer.scrollTop = conversationContainer.scrollHeight;
  };
  
  // Handle audio response
  const handleAudioResponse = async (base64Audio) => {
    try {
      // Reset for next response
      currentAIResponse = '';
      aiMessageElement = null;
      
      // Play the audio response
      await playAudioFromBase64(base64Audio);
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };
  
  // Initialize Web Audio API
  const initAudioContext = () => {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      return true;
    } catch (error) {
      console.error('Web Audio API not supported:', error);
      return false;
    }
  };
  
  // Play audio with Web Audio API
  const playAudioFromBase64 = async (base64Audio) => {
    try {
      if (!audioContext) {
        if (!initAudioContext()) {
          // Fallback to standard Audio element
          const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
          return audio.play();
        }
      }
      
      // Decode the base64 string to ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Decode audio data
      const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
      
      // Create and connect nodes
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      
      // Play audio
      source.start(0);
      
      return new Promise((resolve) => {
        source.onended = resolve;
      });
    } catch (error) {
      console.error('Error playing audio:', error);
      // Fallback
      const audio = new Audio(`data:audio/mpeg;base64,${base64Audio}`);
      return audio.play();
    }
  };
  
  // Initialize audio recording with level visualization
  const initAudioRecording = async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Initialize audio context if not already done
      if (!audioContext) {
        initAudioContext();
      }
      
      // Create analyzer for audio levels
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      // Connect microphone to analyzer
      microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);
      
      // Setup audio processor for level visualization
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      // Create script processor for real-time processing
      const processorBufferSize = 2048;
      audioProcessor = audioContext.createScriptProcessor(processorBufferSize, 1, 1);
      
      audioProcessor.onaudioprocess = () => {
        if (!isRecording) return;
        
        // Get audio levels
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average level
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // Update level bar (0-100%)
        const level = Math.min(100, Math.max(0, average * 1.5)); // Scale for better visualization
        audioLevelBar.style.width = `${level}%`;
        
        // Change color based on level
        if (level > 60) {
          audioLevelBar.style.backgroundColor = '#ef4444'; // Red when loud
        } else if (level > 30) {
          audioLevelBar.style.backgroundColor = '#f59e0b'; // Amber for medium
        } else {
          audioLevelBar.style.backgroundColor = '#10b981'; // Green for quiet/normal
        }
      };
      
      // Connect processor
      audioProcessor.connect(audioContext.destination);
      analyser.connect(audioProcessor);
      
      // Set up MediaRecorder with the stream
      mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        if (audioChunks.length === 0) return;
        
        // Reset audio level bar
        audioLevelBar.style.width = '0%';
        
        // Process the recorded audio
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        
        // Convert to base64 for sending via WebSocket
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = function() {
          const base64data = reader.result.split(',')[1]; // Remove the data URL prefix
          
          // Send the audio data to the server
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'audio',
              audio: base64data
            }));
          }
        };
        
        // Reset audio chunks for next recording
        audioChunks = [];
      };
      
      // Enable the record button
      recordButton.disabled = false;
      updateStatus('Ready to record. Press and hold to speak.');
      
    } catch (error) {
      console.error('Error initializing audio recording:', error);
      updateStatus(statusMessages.ERROR + 'Unable to access microphone');
    }
  };
  
  // Update status display
  const updateStatus = (message) => {
    statusElement.textContent = message;
  };
  
  // Add message to conversation
  const addMessage = (text, sender, isTemporary = false) => {
    // If there's a temporary message and we're adding a non-temporary one, 
    // remove the temporary message
    if (!isTemporary) {
      const tempMessages = conversationContainer.querySelectorAll('.temp-message');
      tempMessages.forEach(msg => conversationContainer.removeChild(msg));
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}-message${isTemporary ? ' temp-message' : ''}`;
    messageElement.textContent = text;
    
    // Clear the default message if it's the first real message
    if (conversationContainer.children.length === 1 && 
        conversationContainer.children[0].classList.contains('text-gray-500')) {
      conversationContainer.innerHTML = '';
    }
    
    conversationContainer.appendChild(messageElement);
    conversationContainer.scrollTop = conversationContainer.scrollHeight;
    
    return messageElement;
  };
  
  // Toggle recording
  const toggleRecording = () => {
    if (isProcessing) {
      updateStatus('Please wait, processing your last message...');
      return;
    }
    
    if (!mediaRecorder) {
      updateStatus('Initializing...');
      initAudioRecording();
      return;
    }
    
    if (isRecording) {
      // Stop recording
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      
      recordButton.classList.remove('recording');
      recordButton.querySelector('span').textContent = 'Press to Talk';
      updateStatus(statusMessages.PROCESSING);
      recordButton.disabled = true; // Disable button while processing
      
      // Add temporary message
      addMessage('Processing...', 'user', true);
    } else {
      // Resume audio context if it was suspended
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      // Start recording
      audioChunks = []; // Clear any previous chunks
      mediaRecorder.start(100); // Collect data every 100ms
      recordButton.classList.add('recording');
      recordButton.querySelector('span').textContent = 'Recording...';
      updateStatus(statusMessages.RECORDING);
    }
    
    isRecording = !isRecording;
  };
  
  // End conversation and start new one
  const endConversation = () => {
    if (isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      recordButton.classList.remove('recording');
      recordButton.querySelector('span').textContent = 'Press to Talk';
    }
    
    // Tell server to end the conversation
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({
        type: 'end',
        sessionId: sessionId
      }));
    }
    
    // Close existing connection
    if (ws) {
      ws.close();
    }
    
    // Reset session
    sessionId = null;
    
    // Re-initialize
    initWebSocket();
    conversationContainer.innerHTML = '<div class="text-gray-500 text-center italic">Started a new conversation. Press and hold to speak.</div>';
    updateStatus('Started a new conversation');
  };
  
  // Add new conversation button
  const addNewConversationButton = () => {
    const headerContainer = document.querySelector('header');
    
    const newConvButton = document.createElement('button');
    newConvButton.className = 'mt-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-lg';
    newConvButton.textContent = 'New Conversation';
    newConvButton.onclick = endConversation;
    
    headerContainer.appendChild(newConvButton);
  };
  
  // Event listeners
  recordButton.addEventListener('mousedown', () => {
    if (!isRecording && !isProcessing) {
      toggleRecording();
    }
  });
  
  recordButton.addEventListener('mouseup', () => {
    if (isRecording) {
      toggleRecording();
    }
  });
  
  recordButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!isRecording && !isProcessing) {
      toggleRecording();
    }
  });
  
  recordButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (isRecording) {
      toggleRecording();
    }
  });
  
  // Handle page visibility changes (stop recording if page becomes hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRecording) {
      toggleRecording();
    }
  });
  
  // Add the New Conversation button
  addNewConversationButton();
  
  // Initialize
  initAudioContext();
  initWebSocket();
  initAudioRecording();
});