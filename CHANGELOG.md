# Changelog

## 3.1.1

- Fix `listFunctionOverrides` return payload to strip Convex system fields (`_id`, `_creationTime`) and match the declared return validator.

## 0.2.0

- **A2A (Agent-to-Agent) Communication**: Added support for agent-to-agent communication through channels
  - Create and manage channels for intra-app agent communication
  - Post messages to channels with priority and TTL support
  - Read messages from channels with cursor-based pagination
  - Mark messages as read
  - Get unread message counts
  - HTTP endpoints: `/agent-bridge/channels`, `/agent-bridge/channels/post`, `/agent-bridge/channels/read`, `/agent-bridge/channels/mark-read`
- Improved channel management with soft-delete support
- Message expiration handling with configurable TTL

## 0.1.0

- Initial release with function gateway, provisioning, and permissions.
