document.addEventListener('DOMContentLoaded', () => {
  const startCallButton = document.getElementById('startCallButton');
  const endCallButton = document.getElementById('endCallButton');
  const statusElement = document.getElementById('status');
  const conversationContainer = document.getElementById('conversation-container');
  const audioLevelBar = document.getElementById('audioLevelBar');
  const callStatus = document.getElementById('callStatus');
  const callStatusText = document.getElementById('callStatusText');
  
  // WebSocket connection variables
  let ws = null;
  let sessionId = null;
  
  // Audio streaming variables
  let mediaRecorder = null;
  let audioContext = null;
  let analyser = null;
  let microphone = null;
  let audioChunks = [];
  let isCallActive = false;
  let isProcessing = false;
  
  // Audio processor for real-time audio level display
  let audioProcessor = null;
  
  // Streaming status information
  const statusMessages = {
    IDLE: 'Ready to start conversation',
    CONNECTING: 'Connecting to server...',
    RECORDING: 'Call in progress...',
    PROCESSING: 'Processing audio...',
    RESPONDING: 'AI is responding...',
    ERROR: 'Error: '
  };
  
  // Initialize WebSocket connection
  const initWebSocket = () => {
    // Use secure WebSocket if page is served over HTTPS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use the /continuous-ws endpoint to identify this as a continuous connection
    const wsUrl = `${protocol}//${window.location.host}/continuous-ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connection established');
      updateStatus(statusMessages.IDLE);
      startCallButton.disabled = false;
    };
    
    ws.onclose = () => {
      console.log('WebSocket connection closed');
      updateStatus(statusMessages.ERROR + 'Connection closed');
      endCall();
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateStatus(statusMessages.ERROR + 'Connection error');
      endCall();
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'session':
          // Session ID received from server
          sessionId = message.sessionId;
          console.log('Conversation ready with session ID:', sessionId);
          startCallButton.disabled = false;
          break;
          
        case 'status':
          // Status update from server
          if (message.status === 'processing') {
            isProcessing = true;
            callStatusText.textContent = 'Processing...';
          } else if (message.status === 'ready') {
            isProcessing = false;
            if (isCallActive) {
              callStatusText.textContent = 'Listening...';
            }
          }
          break;
          
        case 'call_status':
          // Call status update
          if (message.status === 'active') {
            isCallActive = true;
            showCallActive();
          } else if (message.status === 'ended') {
            isCallActive = false;
            showCallEnded();
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
      
      // Update call status
      callStatusText.textContent = 'AI is responding...';
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
      
      // After audio is done, update call status if still active
      if (isCallActive) {
        callStatusText.textContent = 'Listening...';
      }
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
  
  // Initialize audio recording
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
        if (!isCallActive) return;
        
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
        
        // Continuously send audio data during active call
        if (isCallActive && !isProcessing) {
          // Capture audio at fixed intervals
          if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            startAudioCapture();
          }
        }
      };
      
      // Connect processor
      audioProcessor.connect(audioContext.destination);
      analyser.connect(audioProcessor);
      
      // Set up MediaRecorder with the stream
      setupMediaRecorder(stream);
      
      // Enable the start call button
      startCallButton.disabled = false;
      updateStatus('Ready to start. Press "Start Call" button to begin.');
      
    } catch (error) {
      console.error('Error initializing audio recording:', error);
      updateStatus(statusMessages.ERROR + 'Unable to access microphone');
    }
  };
  
  // Setup MediaRecorder
  const setupMediaRecorder = (stream) => {
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      if (audioChunks.length === 0) return;
      
      // Process the recorded audio
      const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      
      // Convert to base64 for sending via WebSocket
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = function() {
        const base64data = reader.result.split(',')[1]; // Remove the data URL prefix
        
        // Send the audio data to the server
        if (ws && ws.readyState === WebSocket.OPEN && isCallActive) {
          ws.send(JSON.stringify({
            type: 'continuous_audio',
            audio: base64data
          }));
        }
      };
      
      // Reset audio chunks for next recording
      audioChunks = [];
      
      // If the call is still active, start the next recording
      if (isCallActive && !isProcessing) {
        startAudioCapture();
      }
    };
  };
  
  // Start audio capture
  const startAudioCapture = () => {
    if (mediaRecorder && mediaRecorder.state !== 'recording' && isCallActive) {
      audioChunks = []; // Clear any previous chunks
      mediaRecorder.start();
      
      // Stop after a fixed duration to process chunks
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 3000); // 3 seconds of audio at a time
    }
  };
  
  // Start the call
  const startCall = () => {
    if (isCallActive) return;
    
    // Make sure audio context is running
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    // Notify server to start the call
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'start_call',
        sessionId: sessionId
      }));
    }
    
    // Show call is active in UI
    showCallActive();
    
    // Start audio capture
    startAudioCapture();
  };
  
  // End the call
  const endCall = () => {
    if (!isCallActive) return;
    
    // Stop recording if active
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    
    // Notify server to end the call
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'end_call',
        sessionId: sessionId
      }));
    }
    
    // Reset audio level bar
    audioLevelBar.style.width = '0%';
    
    // Show call has ended in UI
    showCallEnded();
  };
  
  // Show call active UI state
  const showCallActive = () => {
    isCallActive = true;
    startCallButton.classList.add('hidden');
    endCallButton.classList.remove('hidden');
    callStatus.classList.remove('hidden');
    callStatusText.textContent = 'Listening...';
    updateStatus('Call in progress. Speak normally.');
  };
  
  // Show call ended UI state
  const showCallEnded = () => {
    isCallActive = false;
    startCallButton.classList.remove('hidden');
    endCallButton.classList.add('hidden');
    callStatus.classList.add('hidden');
    updateStatus('Call ended. Press "Start Call" to begin a new conversation.');
  };
  
  // Update status display
  const updateStatus = (message) => {
    statusElement.textContent = message;
  };
  
  // Add message to conversation
  const addMessage = (text, sender) => {
    // Skip if text is empty or too short (probably noise)
    if (!text || text.trim().length < 2) return null;
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}-message`;
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
  
  // Add new conversation button
  const addNewConversationButton = () => {
    const headerContainer = document.querySelector('header');
    
    const newConvButton = document.createElement('button');
    newConvButton.className = 'mt-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded-lg';
    newConvButton.textContent = 'New Conversation';
    newConvButton.onclick = resetConversation;
    
    headerContainer.appendChild(newConvButton);
  };
  
  // Reset conversation
  const resetConversation = () => {
    // End the current call if active
    if (isCallActive) {
      endCall();
    }
    
    // Close the current WebSocket connection
    if (ws) {
      ws.close();
    }
    
    // Reset UI
    conversationContainer.innerHTML = '<div class="text-gray-500 text-center italic">Starting a new conversation...</div>';
    audioLevelBar.style.width = '0%';
    
    // Reinitialize everything
    initWebSocket();
    
    updateStatus('New conversation started. Press "Start Call" to begin.');
  };
  
  // Event listeners
  startCallButton.addEventListener('click', startCall);
  endCallButton.addEventListener('click', endCall);
  
  // Handle page visibility changes (pause recording if page becomes hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isCallActive) {
      // Don't end the call completely, but pause recording
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    } else if (!document.hidden && isCallActive) {
      // Resume recording when page becomes visible again
      startAudioCapture();
    }
  });
  
  // Add new conversation button
  addNewConversationButton();
  
  // Initialize
  initAudioContext();
  initWebSocket();
  initAudioRecording();
}); 