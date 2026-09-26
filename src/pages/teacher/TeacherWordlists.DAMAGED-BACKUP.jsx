{items.map(
  (item, index) => (
    <div
      key={`${item.word}-${index}`}
      className="
        border border-line
        bg-panel
        rounded-md
        p-3
        flex flex-col gap-2
      "
    >

      <div className="flex items-center justify-between gap-3">

        <div className="font-medium text-paper">
          {item.word}
        </div>

        <span className="text-[10px] font-mono text-mist">
          {index + 1}/
          {items.length}
        </span>

      </div>

      <input
        value={
          item.uzbek_translation ||
          ''
        }
        onChange={(e) =>
          updateItem(
            index,
            'uzbek_translation',
            e.target.value
          )
        }
        placeholder="Uzbek translation"
        className="
          focus-ring
          bg-panel-2
          border border-line
          rounded-md
          px-2.5 py-2
          text-sm
        "
      />

    </div>
  )
)}