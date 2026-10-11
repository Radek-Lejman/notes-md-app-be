import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { MAX_CHAT_MESSAGE_LENGTH, MAX_CHAT_MESSAGES } from '../consts/ai.consts';

export const CHAT_ROLES = ['user', 'assistant'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export class ChatMessageDto {
  @IsIn(CHAT_ROLES)
  role: ChatRole;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
  content: string;
}

/** The conversation must end with the user's new message — it is what the model answers. */
const EndsWithUserMessage = () =>
  ValidateBy({
    name: 'endsWithUserMessage',
    validator: {
      validate: (messages: unknown) =>
        Array.isArray(messages) && (messages.at(-1) as ChatMessageDto | undefined)?.role === 'user',
      defaultMessage: () => 'the last message must have role "user"',
    },
  });

export class ChatDto {
  /** Conversation so far, oldest first; the last one is the user's new message. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CHAT_MESSAGES)
  @EndsWithUserMessage()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  /** Note the chat is opened from; its content is given to the model as context. */
  @IsOptional()
  @IsUUID()
  noteId?: string;
}
