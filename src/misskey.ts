export type Emojis = unknown

export interface BadgeRole {
  name: string
  iconUrl: string
}

export interface User {
  id: string
  name: string
  username: string
  host?: unknown
  avatarUrl: string
  avatarBlurhash: string
  isBot: boolean
  isCat: boolean
  emojis: Emojis
  onlineStatus: string
  badgeRoles: BadgeRole[]
}

export interface Reactions {
  [key: string]: number
}

export interface ReactionEmojis {
  [key: string]: string
}

export interface User2 {
  id: string
  name: string
  username: string
  host?: unknown
  avatarUrl: string
  avatarBlurhash: string
  isBot: boolean
  isCat: boolean
  emojis: Emojis
  onlineStatus: string
  badgeRoles: BadgeRole[]
}

export interface Properties {
  width: number
  height: number
}

export interface File {
  id: string
  createdAt: Date
  name: string
  type: string
  md5: string
  size: number
  isSensitive: boolean
  blurhash: string
  properties: Properties
  url: string
  thumbnailUrl: string
  comment?: unknown
  folderId?: unknown
  folder?: unknown
  userId?: unknown
  user?: unknown
}

export interface Channel {
  id: string
  name: string
}

export interface Renote {
  id: string
  createdAt: Date
  userId: string
  user: User2
  text: string
  cw: string
  visibility: string
  localOnly: boolean
  renoteCount: number
  repliesCount: number
  reactions: Reactions
  reactionEmojis: ReactionEmojis
  fileIds: string[]
  files: File[]
  replyId?: unknown
  renoteId?: unknown
  mentions: string[]
  channelId: string
  channel: Channel
}

export interface Channel2 {
  id: string
  name: string
}

export interface Note {
  id: string
  createdAt: Date
  userId: string
  user: User
  text: string
  cw?: unknown
  visibility: string
  localOnly: boolean
  renoteCount: number
  repliesCount: number
  reactions: Reactions
  reactionEmojis: ReactionEmojis
  fileIds: unknown[]
  files: unknown[]
  replyId?: unknown
  renoteId: string
  renote: Renote
  channelId: string
  channel: Channel2
}

export type NotesUserListTimelineResponse = Note[]
