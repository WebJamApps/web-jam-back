# gig rules



- **EXIF Image Auto-Orientation & Aspect Ratio Padding with Sharp**: When converting, resizing, or padding user-supplied images using `sharp`, phone photos often store landscape pixel dimensions accompanied by an EXIF orientation tag (values 5–8) that indicates a 90-degree or 270-degree rotation. Because `sharp(input).metadata()` reports the un-rotated raw dimensions from the file header, padding calculations that do not account for EXIF orientation will treat portrait photos as landscape, select the wrong padding axis, and strip EXIF orientation metadata on JPEG output. Always evaluate `meta.orientation` (swapping width and height for orientations 5–8) and call `sharp(input).autoOrient()` so padding calculations align with the visual photo.
