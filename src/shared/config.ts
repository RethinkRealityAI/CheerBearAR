// Ported as-is from the old app (src/server/types.ts). Owner: server-voice (trim what no longer applies:
// iframe URL, GCS model URL, server-only fields; keep the shape the admin panel and app rely on).

// Runtime configuration types for the admin panel and backend

export type UiMode = 'calm' | 'chat' | 'call_debug';
export type IntentMatchingEngine = 'local' | 'openai' | 'hybrid';
export type TranscriptVisibility = 'off' | 'call_debug_only' | 'chat_only' | 'chat_and_call_debug';
export type TriggerDispatchMode = 'first_only' | 'queue_all';

export interface LocalClassifier {
    keywords: string[];
    synonyms: Record<string, string[]>;
    examples: Record<string, string[]>;
    morphologyEnabled: boolean;
}

export interface SmsPolicy {
    sendTypedChatToSms: boolean;
    sendSpeechToSms: boolean;
}

export interface TriggerPolicy {
    partialTriggerEnabled: boolean;
    triggerCooldownMs: number;
    dispatchMode: TriggerDispatchMode;
    dispatchIntervalMs: number;
}

export interface WelcomeModalItem {
    id: string;
    enabled: boolean;
    title: string;
    description: string;
    /**
     * A safe icon key mapped client-side (e.g. "Phone", "MessageSquare", "Home", "Gamepad2").
     * Unknown values should fall back to a default icon.
     */
    icon: string;
    imageUrl?: string;
}

export interface WelcomeModalConfig {
    enabled: boolean;
    /**
     * When true, dismissing the modal persists per device (localStorage).
     * Bump `version` to show again.
     */
    showOnce: boolean;
    /**
     * Bump to force re-show when `showOnce` is enabled.
     */
    version: number;
    title: string;
    description: string;
    heroImageUrl?: string;
    /**
     * Delay (ms) for the welcome modal after AR is ready.
     * This overrides the UI delay, but will be clamped to never appear before the UI.
     * Set to 0 to show with the UI.
     */
    delayMs: number;
    items: WelcomeModalItem[];
}

export type SettingsPanelItemId =
    // User-facing items
    | 'trigger_keywords'
    | 'experience_mode'
    | 'call_transcripts_toggle'
    | 'input_mode'
    | 'user_triggers'
    | 'call_mode_toggle'
    // Admin items
    | 'admin_transcript_visibility'
    | 'admin_intent_engine'
    | 'admin_trigger_policy'
    | 'admin_sms_policy'
    | 'admin_allow_user_audio_to_openai'
    | 'admin_english_only';

export interface SettingsPanelConfig {
    items: Record<SettingsPanelItemId, boolean>;
}

export interface UiCustomization {
    experienceName: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    headerTitle: string;
    chatPlaceholder: string;
    commandPlaceholder: string;
    callButtonText: string;
    hangupButtonText: string;
    collapsedChatText: string;
    showQuickActionsButton: boolean;
    showSettingsButton: boolean;
    showKeyboardHelpButton: boolean;
    showCallButton: boolean;
    showMobileCallButton: boolean;
    // Default UI states
    defaultChatExpandedDesktop: boolean;  // Whether chat is expanded by default on desktop
    defaultChatExpandedMobile: boolean;   // Whether chat is expanded by default on mobile
    defaultCallModeDesktop: boolean;      // Whether call mode (orb) is enabled on desktop
    defaultCallModeMobile: boolean;       // Whether call mode (orb) is enabled on mobile
    uiDelayMs: number;                    // Delay before showing UI after AR loads (for splash screen)
    welcomeModal: WelcomeModalConfig;
    settingsPanel: SettingsPanelConfig;
}

export interface LipSyncDisplayConfig {
    showControlsPanel: boolean;
    showDebugHud: boolean;
    /** Optional background image URL for the Twilio lip sync page (e.g. from admin upload or GCS). */
    backgroundImageUrl?: string;
    /** Active 3D model URL for the lip sync page. When set, overrides CARE_BEAR_MODEL_URL env var. */
    modelUrl?: string;
}

export interface UiPrefs {
    useCallMode: boolean;
    isCommandMode: boolean;
    customization: UiCustomization;
}

export interface GameModeHints {
    general: string[];  // General questions for any trigger word
    specific: Record<string, string[]>;  // Word-specific hints
}

export interface GameMode {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    triggerWords: string[];
    hints: GameModeHints;
    objective: string;
    instructions?: string;  // Optional instructions displayed to user
}

export interface AppConfig {
    modeDefault: UiMode;
    allowUserTriggers: boolean;
    allowUserAudioToOpenAI: boolean;
    intentMatchingEngine: IntentMatchingEngine;
    localClassifier: LocalClassifier;
    transcriptVisibility: TranscriptVisibility;
    smsPolicy: SmsPolicy;
    englishOnlyTranscripts: boolean;
    triggerPolicy: TriggerPolicy;
    ui: UiPrefs;
    gameModes: GameMode[];
    activeGameMode: string | null;
    /** Twilio outbound caller ID / "from" number (E.164). Empty = use TWILIO_PHONE_NUMBER env. */
    twilioPhoneNumber: string;
    /** AR experience iframe URL (e.g. webxr.run). Shown in main app when set. */
    arIframeUrl: string;
    /** Lip sync page display settings */
    lipSync: LipSyncDisplayConfig;
}

// Default configuration
export const DEFAULT_CONFIG: AppConfig = {
    modeDefault: 'calm',
    allowUserTriggers: false,
    allowUserAudioToOpenAI: false,
    intentMatchingEngine: 'local',
    localClassifier: {
        keywords: [
            'House',
            'Sparkle',
            'Running',
            'WakeUp',
            'Sleep',
            'Dance',
            'Wave',
            'Magic',
            'Cold',
            'Party',
            'Rainbow'
        ],
        synonyms: {
            house: ['home', 'houses'],
            sparkle: ['sparkles', 'sparkly', 'glitter'],
            running: ['run', 'ran'],
            wakeup: ['wake', 'wake up', 'wake-up', 'waking', 'woke'],
            sleep: ['sleepy', 'nap', 'sleeping', 'slept'],
            dance: ['dancing', 'danced', 'dances'],
            wave: ['waving', 'waved', 'waves'],
            magic: ['magical', 'spell'],
            cold: ['chill', 'freezing', 'icy'],
            party: ['partying', 'parties', 'partied', 'celebrate', 'celebration'],
            rainbow: ['rainbows', 'colorful', 'colors']
        },
        examples: {},
        morphologyEnabled: false
    },
    transcriptVisibility: 'off',
    smsPolicy: {
        sendTypedChatToSms: true,
        sendSpeechToSms: false
    },
    englishOnlyTranscripts: true,
    triggerPolicy: {
        partialTriggerEnabled: false,        // Disabled by default to reduce false positives
        triggerCooldownMs: 3000,             // Increased from 1500ms to reduce sensitivity
        dispatchMode: 'first_only',          // Changed from queue_all to prevent multiple rapid triggers
        dispatchIntervalMs: 1000             // Increased from 700ms for more spacing
    },
    ui: {
        useCallMode: true,  // Orb UI on mobile; desktop still shows side chat (isCallModeActive = useCallMode && isMobileView)
        isCommandMode: false,
        customization: {
            experienceName: 'Cheer Bear AI',
            primaryColor: '#ec4899',
            secondaryColor: '#7c3aed',
            accentColor: '#fbbf24',
            headerTitle: 'Cheer Bear AI',
            chatPlaceholder: 'Type message...',
            commandPlaceholder: 'Direct Trigger...',
            callButtonText: 'Start Call',
            hangupButtonText: 'End Call',
            collapsedChatText: 'Chat to Care Bear',
            showQuickActionsButton: true,
            showSettingsButton: true,
            showKeyboardHelpButton: true,
            showCallButton: true,
            showMobileCallButton: true,
            // Default UI states
            defaultChatExpandedDesktop: true,   // Chat open by default on desktop
            defaultChatExpandedMobile: false,   // Chat collapsed by default on mobile
            defaultCallModeDesktop: false,      // No orb on desktop by default
            defaultCallModeMobile: true,        // Orb enabled on mobile by default
            uiDelayMs: 5000,                    // 5 second delay before showing UI
            welcomeModal: {
                enabled: true,
                showOnce: true,
                version: 1,
                title: 'Welcome to Cheer Bear AR',
                description: 'Meet Cheer Bear and explore the experience. Try calling or chatting, explore Cheer Bear’s house, and play word games together.',
                heroImageUrl: '',
                delayMs: 0,
                items: [
                    {
                        id: 'call-chat',
                        enabled: true,
                        title: 'Call or chat to Cheer Bear',
                        description: 'Say hello and talk with Cheer Bear in real time.',
                        icon: 'Phone'
                    },
                    {
                        id: 'explore-house',
                        enabled: true,
                        title: 'Explore Cheer Bear’s house',
                        description: 'Look around and discover Cheer Bear’s world in AR.',
                        icon: 'Home'
                    },
                    {
                        id: 'word-games',
                        enabled: true,
                        title: 'Play word games',
                        description: 'Try game modes and get Cheer Bear to say special words.',
                        icon: 'Gamepad2'
                    }
                ]
            },
            settingsPanel: {
                items: {
                    // User-facing items (enabled by default per user selection)
                    trigger_keywords: true,
                    experience_mode: true,
                    call_transcripts_toggle: true,
                    input_mode: true,
                    user_triggers: true,
                    call_mode_toggle: true,
                    // Admin items (enabled by default per user selection)
                    admin_transcript_visibility: true,
                    admin_intent_engine: true,
                    admin_trigger_policy: true,
                    admin_sms_policy: true,
                    admin_allow_user_audio_to_openai: true,
                    admin_english_only: true
                }
            }
        }
    },
    twilioPhoneNumber: '',
    arIframeUrl: 'https://webxr.run/DwO2bN5nVPvNR',
    lipSync: {
        showControlsPanel: true,
        showDebugHud: true,
        backgroundImageUrl: undefined as string | undefined,
    },
    gameModes: [
        {
            id: 'chat-time',
            name: 'Chat Time',
            description: 'Freely chat with Cheer Bear and discover all the magical words!',
            enabled: true,
            triggerWords: [], // Auto-synced to all keywords at runtime
            hints: {
                general: [
                    "What's your favorite thing to do?",
                    "Tell me about yourself",
                    "What makes you happy?",
                    "How do you help others feel better?",
                    "What's a fun memory you have?",
                    "What do you like about Care-a-Lot?",
                    "What's your favorite color?",
                    "Do you have any special talents?",
                    "What's your favorite season?",
                    "Tell me about your friends"
                ],
                specific: {}
            },
            objective: 'Freely chat with Cheer Bear and ask it questions about itself, or just have any kind of conversation. When it says certain words, something magical will happen in this scene!',
            instructions: 'Freely chat with Cheer Bear and ask it questions about itself, or just have any kind of conversation. When Cheer Bear says any of the trigger words, something magical will happen in this scene!'
        },
        {
            id: 'rainbow-adventure',
            name: 'Rainbow Adventure',
            description: 'Explore the colorful world of Care-a-Lot!',
            enabled: true,
            triggerWords: ['Rainbow', 'Sparkle', 'Magic', 'Party'],
            hints: {
                general: [
                    "Tell me more about where you're from",
                    "What's your favorite thing about Care-a-Lot?",
                    "What makes your home so special?"
                ],
                specific: {
                    rainbow: [
                        "What do you see in the sky after it rains?",
                        "What colors can you see from your home?",
                        "Tell me about the beautiful things in Care-a-Lot"
                    ],
                    sparkle: [
                        "What makes things shine and twinkle?",
                        "Do you like glittery things?",
                        "What's the most beautiful thing you've ever seen?"
                    ],
                    magic: [
                        "Can you do anything magical?",
                        "Tell me about something amazing that happened",
                        "What special powers do Care Bears have?"
                    ],
                    party: [
                        "How do you celebrate special occasions?",
                        "What's your favorite way to have fun?",
                        "Do you like celebrations?"
                    ]
                }
            },
            objective: 'Get Cheer Bear to say all the rainbow-themed words to trigger something cool in the scene!',
            instructions: 'Ask Cheer Bear questions about their home, favorite things, and magical world. Be creative - you cannot directly ask them to say specific words!'
        },
        {
            id: 'dance-party',
            name: 'Dance Party',
            description: 'Get Cheer Bear ready to party!',
            enabled: true,
            triggerWords: ['Dance', 'Wave', 'Party', 'Running'],
            hints: {
                general: [
                    "What do you like to do for fun?",
                    "How do you celebrate with friends?",
                    "What activities make you happy?"
                ],
                specific: {
                    dance: [
                        "Do you like to move to music?",
                        "What's your favorite way to express joy?",
                        "Show me how you celebrate!"
                    ],
                    wave: [
                        "How do you greet your friends?",
                        "Can you say hello to everyone?",
                        "What do you do when you see a friend?"
                    ],
                    party: [
                        "What's the best celebration you've had?",
                        "How do you make special moments fun?",
                        "What do you do on birthdays?"
                    ],
                    running: [
                        "Do you like to exercise?",
                        "What games do you play outside?",
                        "How do you stay active?"
                    ]
                }
            },
            objective: 'Get Cheer Bear to say these words to trigger something cool in the scene!'
        },
        {
            id: 'care-bear-home',
            name: 'Care Bear Home',
            description: "Learn about Cheer Bear's daily routine!",
            enabled: true,
            triggerWords: ['House', 'Sleep', 'WakeUp', 'Cold'],
            hints: {
                general: [
                    "Tell me about your day",
                    "What's your daily routine like?",
                    "Where do you live?"
                ],
                specific: {
                    house: [
                        "What does your home look like?",
                        "Where do you live in Care-a-Lot?",
                        "Describe your favorite room"
                    ],
                    sleep: [
                        "What do you do when you're tired?",
                        "Do you have sweet dreams?",
                        "What helps you relax?"
                    ],
                    wakeup: [
                        "What do you do in the morning?",
                        "How do you start your day?",
                        "What's the first thing you do when you open your eyes?"
                    ],
                    cold: [
                        "What do you do when it's chilly?",
                        "How do you stay warm?",
                        "What's winter like in Care-a-Lot?"
                    ]
                }
            },
            objective: "Get Cheer Bear to say these words to trigger something cool in the scene!"
        }
    ],
    activeGameMode: 'chat-time'
};

// Deep merge helper for partial config updates
export function mergeConfig(base: AppConfig, partial: Partial<AppConfig>): AppConfig {
    const result = { ...base };

    for (const key of Object.keys(partial) as (keyof AppConfig)[]) {
        const value = partial[key];
        if (value === undefined) continue;

        if (key === 'gameModes' && Array.isArray(value) && value.length === 0) {
            // Preserve defaults if persisted config accidentally saved an empty list
            continue;
        }

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Deep merge for nested objects
            (result as any)[key] = { ...(base[key] as object), ...(value as object) };
        } else {
            (result as any)[key] = value;
        }
    }

    return result;
}
