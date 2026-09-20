Put work videos and poster images in this folder.

Filenames the pages look for:
  waterloo.mp4            (featured, ultra-wide)
  riyadh-boulevard.mp4    (featured, multi-screen)
  liv-golf.mp4
  title-localisation.mp4
  bbc.mp4
  vidsy.mp4
  interface.mp4

Matching .jpg poster frames are optional but worth adding.

Keep every file under 100 MB — GitHub rejects anything larger.
Aim for 8 MB or so:

  ffmpeg -i source.mov -vf scale=1920:-2 -c:v libx264 -crf 24 -preset slow -an work/waterloo.mp4
