import { Browser } from 'puppeteer-core'
import fs from 'node:fs'
import { Logger } from '@book000/node-utils'
import { DiscordApi, DiscordApiError } from './discord'
import { NotesUserListTimelineResponse } from './misskey'
import { Notified } from './notified'
import { downloadNotePreviewImage } from './utils'

/** Collaborators and run-wide state needed by {@link processNotes}. */
export interface ProcessNotesDependencies {
  browser: Browser
  discord: DiscordApi
  instanceDomain: string
  isFirst: boolean
  logger: Logger
}

/**
 * Screenshots each note and posts it to Discord, in the given order.
 *
 * A note is recorded as notified only after its Discord send succeeds. A
 * failure for one note leaves it unsent (retried on the next run) and moves on
 * to the next note, except for a `DiscordApiError` with `abortBatch`, which
 * stops the run.
 *
 * @param notes Notes to process, oldest first
 */
export async function processNotes(
  notes: NotesUserListTimelineResponse,
  {
    browser,
    discord,
    instanceDomain,
    isFirst,
    logger
  }: ProcessNotesDependencies
): Promise<void> {
  for (const note of notes) {
    const noteId = note.id
    if (Notified.isNotified(noteId)) {
      continue
    }

    if (isFirst) {
      Notified.addNotified(noteId)
      continue
    }

    // Wait before notifying so that reactions are included in the screenshot
    const createdAt = new Date(note.createdAt)
    const now = new Date()
    const diff = now.getTime() - createdAt.getTime()
    if (diff < 1000 * 60 * 5) {
      logger.info(`⏭️ Skipped: ${noteId}`)
      continue
    }

    const url = `https://${instanceDomain}/notes/${noteId}`
    const hasCW = note.cw != null
    const sensitiveFileIds = note.files
      .filter((file) => file.isSensitive)
      .map((file) => file.id)
    // note.text can be null (e.g. media-only notes); fall back to '' so expectedText is always a string
    const expectedText = note.cw ?? note.text ?? ''

    logger.info(`📷 Downloading image: ${url}`)
    let imagePath: string
    try {
      const result = await downloadNotePreviewImage(
        browser,
        instanceDomain,
        noteId,
        expectedText,
        hasCW,
        sensitiveFileIds
      )
      imagePath = result.imagePath
    } catch (error) {
      // Catch here so one note's capture failure does not block the others.
      // Notified.addNotified is not called, so the note is retried on the next loop iteration (entrypoint.sh)
      logger.warn(`⚠️ Failed to download image: ${url}`, error as Error)
      continue
    }

    logger.info('📝 Send messages to Discord')

    const isSpoiler = hasCW || sensitiveFileIds.length > 0
    try {
      await discord.sendMessage(
        '',
        {
          title: `👀 ${instanceDomain} で見る`,
          url,
          image: {
            url: `attachment://${isSpoiler ? 'SPOILER_' : ''}image.png`
          }
        },
        imagePath,
        isSpoiler
      )
    } catch (error) {
      // Log only the message: the error's cause can carry the webhook URL
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof DiscordApiError && error.abortBatch) {
        logger.warn(
          `⚠️ Discord is unavailable or rate limited, stopping this run: ${url} (${message}, retryAfterMs: ${error.retryAfterMs ?? 'unknown'})`
        )
        break
      }
      logger.warn(
        `⚠️ Failed to send to Discord (note skipped): ${url} (${message})`
      )
      continue
    } finally {
      try {
        fs.rmSync(imagePath, { force: true })
      } catch {
        logger.warn('⚠️ Failed to remove screenshot')
      }
    }

    Notified.addNotified(noteId)
  }
}
