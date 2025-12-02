// ========== CONTACT CHAT INTERFACE CONTROLLER ==========
// Vanilla JavaScript implementation of the React chat interface functionality

class ContactChatController {
    constructor() {
        // State management (equivalent to React useState)
        this.messages = [
            {
                id: 1,
                type: 'assistant',
                content: 'Hello! How can I help you today?',
                timestamp: new Date()
            }
        ];
        
        this.inputValue = '';
        this.isTyping = false;
        this.isInitialized = false;
        this.messageIdCounter = 2;
        
        // Scramble effect instances
        this.scrambleInstances = new Map();
        
        // Predefined responses for realistic chat interaction
        this.responses = [
            "Thank you for your message! I'll get back to you as soon as possible.",
            "That's an interesting project! I'd love to discuss this further with you.",
            "I appreciate you reaching out. Let me know more details about what you need.",
            "Great question! I have experience with similar projects.",
            "I'm excited to potentially work together on this!",
            "Thanks for contacting me. Your project sounds fascinating!",
            "I'd be happy to help with that. When would be a good time to discuss?",
            "That's exactly the kind of work I enjoy doing!",
            "I'm available for new projects. Let's talk about your requirements.",
            "Thanks for thinking of me for this project!, im excited to be working together"
        ];
        
        this.init();
    }
    
    init() {
        console.log('📱 Contact Chat initializing...');
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeComponents());
        } else {
            this.initializeComponents();
        }
    }
    
    initializeComponents() {
        // Get DOM elements
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.typingIndicator = document.getElementById('typingIndicator');
        this.messagesEnd = document.getElementById('messagesEnd');
        this.messagesContainer = document.getElementById('chatMessagesContainer');
        this.scrollToBottomBtn = document.getElementById('scrollToBottom');
        
        // Additional buttons
        this.attachmentBtn = document.getElementById('attachmentBtn');
        this.imageBtn = document.getElementById('imageBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
        
        if (!this.chatMessages || !this.chatInput || !this.sendBtn) {
            console.error('❌ Required chat elements not found!');
            return;
        }
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup scroll functionality
        this.setupScrollFunctionality();
        
        // Apply scramble effect to initial message if it exists
        setTimeout(() => {
            const initialMessage = this.chatMessages.querySelector('.message-text[data-message-id="1"]');
            if (initialMessage) {
                this.applyScrambleEffect(1, 'Hello! How can I help you today?');
                
                // Update initial message timestamp to proper format
                const initialTimestamp = this.chatMessages.querySelector('.message-time[data-message-id="1"]');
                if (initialTimestamp) {
                    const initialMessageData = this.messages.find(msg => msg.id === 1);
                    if (initialMessageData) {
                        initialTimestamp.textContent = this.formatTime(initialMessageData.timestamp);
                    }
                }
            }
        }, 500);
        
        // Initialize UI state
        this.updateSendButtonState();
        this.scrollToBottom();
        
        this.isInitialized = true;
        console.log('✅ Contact Chat initialized successfully');
    }
    
    setupEventListeners() {
        // Input handling
        this.chatInput.addEventListener('input', (e) => this.handleInputChange(e));
        this.chatInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
        // Send button
        this.sendBtn.addEventListener('click', () => this.handleSendMessage());
        
        // Additional button handlers (placeholder functionality)
        if (this.attachmentBtn) {
            this.attachmentBtn.addEventListener('click', () => this.handleAttachment());
        }
        
        if (this.imageBtn) {
            this.imageBtn.addEventListener('click', () => this.handleImage());
        }
        
        if (this.voiceBtn) {
            this.voiceBtn.addEventListener('click', () => this.handleVoice());
        }
        
        // Auto-resize textarea behavior for input
        this.chatInput.addEventListener('input', () => this.autoResizeInput());
    }
    
    setupScrollFunctionality() {
        if (!this.chatMessages || !this.scrollToBottomBtn) {
            console.warn('⚠️ Scroll elements not found, skipping scroll setup');
            return;
        }
        
        // Track user scrolling to show/hide scroll-to-bottom button
        let scrollTimeout;
        this.isUserScrolling = false;
        this.isNearBottom = true;
        
        this.chatMessages.addEventListener('scroll', () => {
            this.isUserScrolling = true;
            
            // Clear existing timeout
            clearTimeout(scrollTimeout);
            
            // Check if user is near bottom (within 100px)
            const scrollTop = this.chatMessages.scrollTop;
            const scrollHeight = this.chatMessages.scrollHeight;
            const clientHeight = this.chatMessages.clientHeight;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            
            this.isNearBottom = distanceFromBottom <= 100;
            
            // Show/hide scroll to bottom button
            if (this.isNearBottom) {
                this.hideScrollToBottomButton();
            } else {
                this.showScrollToBottomButton();
            }
            
            // Reset scrolling flag after a delay
            scrollTimeout = setTimeout(() => {
                this.isUserScrolling = false;
            }, 150);
        });
        
        // Scroll to bottom button click handler
        this.scrollToBottomBtn.addEventListener('click', () => {
            this.scrollToBottom(true); // Force scroll
            this.hideScrollToBottomButton();
        });
        
        console.log('✅ Scroll functionality initialized');
    }
    
    handleInputChange(e) {
        this.inputValue = e.target.value;
        this.updateSendButtonState();
    }
    
    handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSendMessage();
        }
    }
    
    handleSendMessage() {
        if (!this.inputValue.trim()) return;
        
        // Create user message
        const userMessage = {
            id: this.messageIdCounter++,
            type: 'user',
            content: this.inputValue.trim(),
            timestamp: new Date()
        };
        
        // Add user message to state and render
        this.messages.push(userMessage);
        this.renderMessage(userMessage);
        
        // Track contact form message event
        if (window.analytics) {
            window.analytics.trackContactForm('message_sent');
        }
        
        // Clear input and update UI
        this.inputValue = '';
        this.chatInput.value = '';
        this.updateSendButtonState();
        
        // Auto-scroll to bottom
        this.scrollToBottom();
        
        // Simulate assistant response
        this.simulateAssistantResponse();
    }
    
    simulateAssistantResponse() {
        // Show typing indicator
        this.showTypingIndicator();
        
        // Simulate response delay (1.5-3 seconds)
        const delay = Math.random() * 1500 + 1500;
        
        setTimeout(() => {
            this.hideTypingIndicator();
            
            // Generate response
            const response = this.generateResponse();
            const assistantMessage = {
                id: this.messageIdCounter++,
                type: 'assistant',
                content: response,
                timestamp: new Date()
            };
            
            // Add assistant message
            this.messages.push(assistantMessage);
            this.renderMessage(assistantMessage);
            this.scrollToBottom();
            
        }, delay);
    }
    
    generateResponse() {
        // Simple response generation based on user input
        const lastMessage = this.messages[this.messages.length - 1];
        const userInput = lastMessage.content.toLowerCase();
        
        // Basic keyword responses
        if (userInput.includes('project') || userInput.includes('work')) {
            return this.responses[1];
        } else if (userInput.includes('price') || userInput.includes('cost') || userInput.includes('budget')) {
            return "I'd be happy to discuss pricing based on your specific requirements. Each project is unique!";
        } else if (userInput.includes('time') || userInput.includes('deadline')) {
            return "Timeline depends on the project scope. Let's discuss your deadline requirements!";
        } else if (userInput.includes('hello') || userInput.includes('hi') || userInput.includes('hey')) {
            return "Hello! Great to meet you. What can I help you with today?";
        } else if (userInput.includes('portfolio') || userInput.includes('examples')) {
            return "You can check out my work in the playground section and browse my projects. What type of work interests you most?";
        } else if (userInput.includes('contact') || userInput.includes('email') || userInput.includes('phone')) {
            return "You can reach me through the social links on my main page, or we can continue chatting right here!";
        } else {
            // Random response for other inputs
            return this.responses[Math.floor(Math.random() * this.responses.length)];
        }
    }
    
    renderMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.type}-message`;
        messageElement.setAttribute('data-message-id', message.id);
        
        const timeString = this.formatTime(message.timestamp);
        
        messageElement.innerHTML = `
            <div class="message-content">
                <p class="message-text" data-message-id="${message.id}">${this.escapeHtml(message.content)}</p>
                <span class="message-time" data-message-id="${message.id}">${timeString}</span>
            </div>
        `;
        
        // Insert before typing indicator and messages end
        this.chatMessages.insertBefore(messageElement, this.messagesEnd);
        
        // Apply scramble effect after element is in DOM and styled
        setTimeout(() => {
            this.applyScrambleEffect(message.id, message.content);
        }, 100);
        
        // Animate in with delay to let scramble effect initialize
        setTimeout(() => {
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateY(10px)';
            messageElement.style.transition = 'all 0.3s ease-out';
            
            requestAnimationFrame(() => {
                messageElement.style.opacity = '1';
                messageElement.style.transform = 'translateY(0)';
            });
        }, 10);
    }
    
    showTypingIndicator() {
        if (this.isTyping) return;
        
        this.isTyping = true;
        this.typingIndicator.style.display = 'flex';
        this.scrollToBottom();
    }
    
    hideTypingIndicator() {
        this.isTyping = false;
        this.typingIndicator.style.display = 'none';
    }
    
    scrollToBottom(force = false) {
        // Only auto-scroll if user is near bottom or force is true
        if (force || this.isNearBottom || !this.isUserScrolling) {
            requestAnimationFrame(() => {
                this.messagesEnd.scrollIntoView({ behavior: 'smooth' });
            });
        }
    }
    
    showScrollToBottomButton() {
        if (this.scrollToBottomBtn) {
            this.scrollToBottomBtn.classList.add('visible');
        }
    }
    
    hideScrollToBottomButton() {
        if (this.scrollToBottomBtn) {
            this.scrollToBottomBtn.classList.remove('visible');
        }
    }
    
    updateSendButtonState() {
        const hasContent = this.inputValue.trim().length > 0;
        this.sendBtn.disabled = !hasContent;
        
        if (hasContent) {
            // Remove inline styles to let CSS handle the enabled state
            this.sendBtn.style.background = '';
            this.sendBtn.style.cursor = '';
            this.sendBtn.style.borderColor = '';
            this.sendBtn.style.color = '';
        } else {
            // Remove inline styles to let CSS handle the disabled state
            this.sendBtn.style.background = '';
            this.sendBtn.style.cursor = '';
            this.sendBtn.style.borderColor = '';
            this.sendBtn.style.color = '';
        }
    }
    
    autoResizeInput() {
        // Auto-resize input to fit content (single line for this design)
        this.chatInput.style.height = 'auto';
        const scrollHeight = this.chatInput.scrollHeight;
        if (scrollHeight <= 44) { // Max single line height
            this.chatInput.style.height = scrollHeight + 'px';
        }
    }
    
    formatTime(date) {
        // Format time in 12-hour format with AM/PM
        const timeString = date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit',
            hour12: true 
        });
        
        // Format date as DD/MM/YYYY
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const dateString = `${day}/${month}/${year}`;
        
        return `${timeString} | ${dateString}`;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    applyScrambleEffect(messageId, content) {
        // Check if scramble library is available
        if (typeof window.createScrambleText === 'undefined') {
            console.warn('⚠️ Scramble library not loaded - skipping effect');
            return;
        }
        
        const messageTextElement = document.querySelector(`.message-text[data-message-id="${messageId}"]`);
        if (!messageTextElement) {
            console.warn('⚠️ Message text element not found for scramble effect');
            return;
        }
        
        try {
            // Store original styling before scramble
            const originalColor = messageTextElement.style.color;
            const computedStyle = window.getComputedStyle(messageTextElement);
            const originalFontSize = computedStyle.fontSize;
            const originalFontWeight = computedStyle.fontWeight;
            const originalLineHeight = computedStyle.lineHeight;
            
            // Apply scramble effect with same settings as playground
            const scrambleInstance = window.createScrambleText(messageTextElement, {
                speed: 0.8,     // From playground settings
                tick: 1,        // From playground settings  
                step: 2.3,      // From playground settings
                scramble: 10,   // From playground settings
                chance: 0.8,    // From playground settings
                overdrive: false // From playground settings
            });
            
            // Preserve styling after scramble initialization
            setTimeout(() => {
                if (messageTextElement) {
                    // Restore original styling that might be lost
                    messageTextElement.style.fontSize = originalFontSize;
                    messageTextElement.style.fontWeight = originalFontWeight;
                    messageTextElement.style.lineHeight = originalLineHeight;
                    if (originalColor) {
                        messageTextElement.style.color = originalColor;
                    }
                }
            }, 50);
            
            // Store instance for potential cleanup
            this.scrambleInstances.set(messageId, scrambleInstance);
            
            // Trigger the scramble effect after a small delay
            setTimeout(() => {
                if (scrambleInstance && scrambleInstance.replay) {
                    scrambleInstance.replay();
                }
            }, 300);
            
        } catch (error) {
            console.warn('⚠️ Failed to apply scramble effect:', error);
        }
    }
    
    // Placeholder handlers for additional buttons
    handleAttachment() {
        console.log('📎 Attachment feature would be implemented here');
        this.showTemporaryMessage('Attachment feature coming soon!');
    }
    
    handleImage() {
        console.log('🖼️ Image upload feature would be implemented here');
        this.showTemporaryMessage('Image upload feature coming soon!');
    }
    
    handleVoice() {
        console.log('🎤 Voice message feature would be implemented here');
        this.showTemporaryMessage('Voice messages feature coming soon!');
    }
    
    showTemporaryMessage(text) {
        // Show a temporary system message
        const tempMessage = {
            id: `temp-${Date.now()}`,
            type: 'assistant',
            content: text,
            timestamp: new Date()
        };
        
        this.renderMessage(tempMessage);
        this.scrollToBottom();
    }
    
    // Public API methods for external interaction
    addMessage(content, type = 'assistant') {
        const message = {
            id: this.messageIdCounter++,
            type: type,
            content: content,
            timestamp: new Date()
        };
        
        this.messages.push(message);
        this.renderMessage(message);
        this.scrollToBottom();
    }
    
    clearChat() {
        // Clear scramble instances
        this.scrambleInstances.clear();
        
        this.messages = [
            {
                id: 1,
                type: 'assistant',
                content: 'Hello! How can I help you today?',
                timestamp: new Date()
            }
        ];
        
        // Clear DOM
        const messageElements = this.chatMessages.querySelectorAll('.message:not(.typing-message)');
        messageElements.forEach(el => el.remove());
        
        // Re-render initial message
        this.renderMessage(this.messages[0]);
        this.scrollToBottom();
    }
    
    // Cleanup method for when component is destroyed
    destroy() {
        this.scrambleInstances.clear();
        console.log('📱 Contact Chat cleanup completed');
    }
}

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
    // Initialize contact chat after a small delay to ensure all scripts are loaded
    setTimeout(() => {
        const contactChat = new ContactChatController();
        window.contactChat = contactChat; // Make available globally for debugging
        console.log('📱 Contact Chat fully loaded and ready!');
    }, 500);
});

// Fallback initialization
if (document.readyState === 'complete') {
    setTimeout(() => {
        if (!window.contactChat) {
            const contactChat = new ContactChatController();
            window.contactChat = contactChat;
        }
    }, 100);
}

// Export utilities for debugging and external use
window.contactChatUtils = {
    addMessage: (content, type = 'assistant') => {
        if (window.contactChat && window.contactChat.isInitialized) {
            window.contactChat.addMessage(content, type);
        }
    },
    
    clearChat: () => {
        if (window.contactChat && window.contactChat.isInitialized) {
            window.contactChat.clearChat();
        }
    },
    
    getMessages: () => {
        if (window.contactChat) {
            return window.contactChat.messages;
        }
        return [];
    }
};

// ========== CLEANUP ON PAGE UNLOAD ==========
window.addEventListener('beforeunload', () => {
    if (window.contactChat && typeof window.contactChat.destroy === 'function') {
        window.contactChat.destroy();
    }
});