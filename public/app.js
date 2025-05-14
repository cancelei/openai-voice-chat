document.addEventListener('DOMContentLoaded', () => {
  const recordButton = document.getElementById('recordButton');
  const statusElement = document.getElementById('status');
  const conversationContainer = document.getElementById('conversation-container');
  
  // Socket.io connection
  const socket = io();
  
  // Audio streaming variables
  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;
  let sessionId = null;
  let isProcessing = false;
  let audioContext = null;
  
  // Streaming status information
  const statusMessages = {
    IDLE: 'Ready to start conversation',
    CONNECTING: 'Connecting to server...',
    RECORDING: 'Listening...',
    PROCESSING: 'Processing your message...',
    RESPONDING: 'AI is responding...',
    ERROR: 'Error: '
  };
  
  // Socket.io event listeners
  socket.on('connect', () => {
    console.log('Connected to server');
    updateStatus(statusMessages.IDLE);
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateStatus(statusMessages.ERROR + 'Disconnected from server');
  });
  
  socket.on('error', (data) => {
    console.error('Server error:', data.message);
    updateStatus(statusMessages.ERROR + data.message);
  });
  
  socket.on('conversationReady', (data) => {
    sessionId = data.sessionId;
    console.log('Conversation ready with session ID:', sessionId);
    recordButton.disabled = false;
    updateStatus(statusMessages.IDLE);
  });
  
  socket.on('processingStatus', (data) => {
    if (data.status === 'processing') {
      isProcessing = true;
      updateStatus(statusMessages.PROCESSING);
    } else if (data.status === 'ready') {
      isProcessing = false;
      recordButton.disabled = false;
      updateStatus(statusMessages.IDLE);
    }
  });
  
  socket.on('transcription', (data) => {
    // Replace temporary message with actual transcription
    addMessage(data.text, 'user');
  });
  
  let currentAIResponse = '';
  let aiMessageElement = null;
  
  socket.on('aiResponseChunk', (data) => {
    if (!aiMessageElement) {
      // Create a new message element for the AI response
      aiMessageElement = document.createElement('div');
      aiMessageElement.className = 'message ai-message';
      conversationContainer.appendChild(aiMessageElement);
      conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
    
    // Append the chunk to the current response
    currentAIResponse += data.text;
    aiMessageElement.textContent = currentAIResponse;
    conversationContainer.scrollTop = conversationContainer.scrollHeight;
  });
  
  socket.on('aiResponseAudio', async (data) => {
    try {
      // Reset for next response
      currentAIResponse = '';
      aiMessageElement = null;
      
      // Play the audio response
      await playAudioFromBase64(data.audio);
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  });
  
  // Initialize the conversation session
  const initConversation = () => {
    updateStatus(statusMessages.CONNECTING);
    socket.emit('initConversation');
    
    // Clear any previous conversation
    conversationContainer.innerHTML = '<div class="text-gray-500 text-center italic">Conversation started. Click the button and speak.</div>';
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
  
  // Initialize MediaRecorder for capturing audio
  const initMediaRecorder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Set up MediaRecorder with stream
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
        
        // Convert to base64 for sending via socket
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = function() {
          const base64data = reader.result.split(',')[1]; // Remove the data URL prefix
          
          // Send the audio data to the server
          socket.emit('finalAudio', {
            sessionId,
            audioBlob: base64data
          });
        };
        
        // Reset audio chunks for next recording
        audioChunks = [];
      };
      
      // Initialize conversation
      initConversation();
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
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
      initMediaRecorder();
      return;
    }
    
    if (isRecording) {
      // Stop recording
      mediaRecorder.stop();
      recordButton.classList.remove('recording');
      recordButton.querySelector('span').textContent = 'Press to Talk';
      updateStatus(statusMessages.PROCESSING);
      recordButton.disabled = true; // Disable button while processing
      
      // Add temporary message
      addMessage('Processing...', 'user', true);
    } else {
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
    if (sessionId) {
      socket.emit('endConversation', { sessionId });
    }
    
    // Reset session
    sessionId = null;
    initConversation();
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
  
  // Add the New Conversation button
  addNewConversationButton();
  
  // Initialize on page load
  initAudioContext();
  initMediaRecorder();
}); 