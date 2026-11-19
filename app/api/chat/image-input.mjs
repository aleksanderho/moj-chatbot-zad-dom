import { z } from "zod";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const maxEncodedLength = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

// Accept inline images only: the server must never fetch a client-selected URL.
export const imagePartSchema = z.object({
  type: z.literal("file"),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  filename: z.string().max(255).optional(),
  url: z.string().max(maxEncodedLength + 40),
}).superRefine((part, context) => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.url);
  if (!match || match[1] !== part.mediaType || match[2].length % 4 !== 0) {
    context.addIssue({ code: "custom", message: "Nieprawidłowy plik zdjęcia." });
    return;
  }
  const bytes = Buffer.from(match[2], "base64");
  const formatMatches = part.mediaType === "image/jpeg"
    ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : part.mediaType === "image/png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!formatMatches || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== match[2]) {
    context.addIssue({ code: "custom", message: "Wybierz JPG, PNG lub WebP do 4 MB." });
  }
});
