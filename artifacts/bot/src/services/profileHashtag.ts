/** Telegram hashtag entities cannot contain punctuation such as / [] or spaces.
 * Preserve all canonical dictionary labels and persisted values unchanged.
 * Normalize ONLY the presentation into one searchable #token on every surface.
 */
export function profileSearchHashtag(label:string):string{
 const normalized=label.normalize("NFKC")
  .replace(/[^\p{L}\p{N}_]+/gu,"_").replace(/^_+|_+$/g,"");
 if(!normalized)throw Error("PROFILE_HASHTAG_EMPTY");
 return "#"+normalized;
}
