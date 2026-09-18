// In-app channel: the Notification row itself is the inbox entry; notify() marks the
// delivery sent at creation time. Kept as a module so the delivery worker has one place per
// channel and later phases (push, SMS) follow the same shape.
export const IN_APP_CHANNEL = "in_app" as const;
