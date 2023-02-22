import axios from 'axios'
import FormData from 'form-data'
import fs from 'node:fs'

export interface DiscordEmbedFooter {
  text: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface DiscordEmbedImage {
  url?: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface DiscordEmbedThumbnail {
  url?: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface DiscordEmbedVideo {
  url?: string
  proxy_url?: string
  height?: number
  width?: number
}

export interface DiscordEmbedProvider {
  name?: string
  url?: string
}

export interface DiscordEmbedAuthor {
  name?: string
  url?: string
  icon_url?: string
  proxy_icon_url?: string
}

export interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbed {
  title?: string
  type?: 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link'
  description?: string
  url?: string
  timestamp?: string
  color?: number
  footer?: DiscordEmbedFooter
  image?: DiscordEmbedImage
  thumbnail?: DiscordEmbedThumbnail
  video?: DiscordEmbedVideo
  provider?: DiscordEmbedProvider
  author?: DiscordEmbedAuthor
  fields?: DiscordEmbedField[]
}

export class DiscordApi {
  private webhookUrl: string

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl
  }

  async sendMessage(
    content: string,
    embed: DiscordEmbed,
    imagePath: string,
    isSpoiler = false
  ) {
    const formData = new FormData()
    formData.append(
      'payload_json',
      JSON.stringify({
        content,
        embeds: [embed]
      })
    )

    const arraybuffer = fs.readFileSync(imagePath)

    formData.append('file', arraybuffer, {
      filename: `${isSpoiler ? 'SPOILER_' : ''}image.png}`,
      contentType: 'image/png'
    })
    const response = await axios.post(this.webhookUrl, formData, {
      headers: formData.getHeaders()
    })
    if (response.status !== 200) {
      throw new Error(`Failed to send message to Discord: ${response.status}`)
    }
  }
}
