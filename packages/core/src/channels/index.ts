export {
    ChannelManager,
    type ChannelPlatform,
    type ChannelStatus,
    type ChannelConfig,
    type Channel,
    type ChannelMessage,
    type ChannelManagerConfig,
} from './channels.js';

export {
    TelegramAdapter,
    DiscordAdapter,
    SlackAdapter,
    WebhookAdapter,
    createAdapter,
    type ChannelAdapter,
    type MessageHandler,
    type TelegramAdapterConfig,
    type DiscordAdapterConfig,
    type SlackAdapterConfig,
    type WebhookAdapterConfig,
    type AdapterConfig,
} from './adapters.js';
