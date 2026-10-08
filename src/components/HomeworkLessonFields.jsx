import Icon from './Icon'
import { lessonHeaderPreview } from '../lib/telegramGroupPost'

const BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME

/*
 * Lesson number + date, and the "also post to the Telegram group"
 * switch, for the homework post / edit forms (2026-10-08).
 */
export default function HomeworkLessonFields({
  lessonNumber,
  lessonDate,
  onLessonNumber,
  onLessonDate,
  telegram, // { supported, linked, title }
  postToTelegram,
  onPostToTelegram,
  telegramLabel = 'Also post to the Telegram group',
}) {
  const header = lessonHeaderPreview(lessonNumber, lessonDate)

  return (
    <div className="rounded-[18px] border border-line bg-panel-2 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-mist">Lesson №</span>
          <input
            type="number"
            min={1}
            max={999}
            inputMode="numeric"
            value={lessonNumber ?? ''}
            onChange={(e) => onLessonNumber(e.target.value === '' ? '' : Math.max(1, Math.min(999, Number(e.target.value))))}
            placeholder="4"
            className="focus-ring w-24 rounded-md border border-line bg-panel px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-mist">Lesson date</span>
          <input
            type="date"
            value={lessonDate || ''}
            onChange={(e) => onLessonDate(e.target.value)}
            className="focus-ring rounded-md border border-line bg-panel px-3 py-2"
          />
        </label>
        {(lessonNumber || lessonDate) && (
          <p className="min-w-0 flex-1 basis-48 pb-2 text-xs text-mist">
            Telegram header: <span className="text-paper-dim">“{header}”</span>
          </p>
        )}
      </div>

      {telegram?.supported && (
        <div className="mt-3 border-t border-line pt-3">
          {telegram.linked ? (
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={postToTelegram}
                onChange={(e) => onPostToTelegram(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brass"
              />
              <span>
                <span className="font-medium text-paper">
                  <Icon name="send" className="mr-1 inline h-3.5 w-3.5" />
                  {telegramLabel}
                </span>
                {telegram.title && <span className="text-mist"> “{telegram.title}”</span>}
                <span className="block text-xs text-mist">The bot posts the task, the files and an “Open on the website” button.</span>
              </span>
            </label>
          ) : (
            <p className="text-xs leading-5 text-mist">
              <Icon name="send" className="mr-1 inline h-3.5 w-3.5" />
              This group has no Telegram chat connected. To post homework there automatically, add
              {BOT ? <b className="text-paper-dim"> @{BOT} </b> : ' the bot '}
              to the group's Telegram chat and send <b className="text-paper-dim">/connect</b> in it.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
