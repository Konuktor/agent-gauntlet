# Demo video

A 60-second screen recording of the live deployment, following
[`docs/DEMO_SCRIPT.md`](../DEMO_SCRIPT.md) beat for beat.

Everything on screen is real: the production URL, the four-run Solari gauntlet
(`baseline` 7 steps, `cookie_popup` 7, `unexpected_modal` **19**,
`expired_session` FAIL), and the evaluator's own assertion table. No live run was
started to record it — the script deliberately uses run data that already exists,
so it costs no Solari credits.

## Files

| File                               | Use                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `agentgauntlet-demo.mp4`           | Clean cut, no captions. Narrate over this one.                                               |
| `agentgauntlet-demo-captioned.mp4` | Burned-in captions. Post-ready, and works muted — which is how most social video is watched. |
| `demo.srt`                         | The narration, as subtitles. Edit here if you want to reword.                                |
| `demo.ass`                         | Styled build of the same, generated from the `.srt`.                                         |

Both cuts are 1440×900, 25 fps, H.264, 60.0 s, about 2 MB each. They are attached
to the [v1.0.1 release](https://github.com/Konuktor/agent-gauntlet/releases/tag/v1.0.1)
rather than committed, so cloning the repository stays cheap.

## Rebuilding

```bash
# 1. record (drives the live site with Playwright)
node scripts/record-demo.mjs

# 2. burn the captions
ffmpeg -i docs/demo/agentgauntlet-demo.mp4 -vf "subtitles=docs/demo/demo.ass" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart \
  -y docs/demo/agentgauntlet-demo-captioned.mp4
```

The recorder pins the run ids it opens, so re-recording produces the same
walkthrough. If the demo database is ever reseeded, update the ids at the top of
`scripts/record-demo.mjs`.

## A note on what is not in it

There is no voiceover. The captions carry the narration from the script, so the
video is usable as-is; if you would rather speak it, use the clean cut and the
script's timings, which the recording follows exactly.
