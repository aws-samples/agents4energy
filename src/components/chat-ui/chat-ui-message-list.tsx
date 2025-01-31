import { SpaceBetween } from "@cloudscape-design/components";
import ChatUIMessage from "./chat-ui-message";
import { Message } from '../../utils/types'

export interface ChatUIMessageListProps {
  messages?: Message[];
  showCopyButton?: boolean;
}

export default function ChatUIMessageList(props: ChatUIMessageListProps) {
  const messages = props.messages || [];

  return (
    <SpaceBetween direction="vertical" size="m">
      {messages.map((message) => (
        <ChatUIMessage
          key={message.id}
          message={message}
          showCopyButton={props.showCopyButton}
          // messages={messages.slice(0, messages.indexOf(message))}
        />
      ))}
    </SpaceBetween>
  );
}
