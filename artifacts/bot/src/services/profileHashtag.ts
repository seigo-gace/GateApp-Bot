/** Profile hashtag rendering shared by public card, preview and personal viewer.
 * Keep the adopted dictionary labels and stored selections unchanged.
 * Punctuation / [] spaces split into independently searchable #tags.
 */
export function profileSearchHashtag(label:string):string{
 const parts=label.normalize("NFKC").split(/[^\p{L}\p{N}_]+/gu).filter(Boolean);
 if(!parts.length)throw Error("PROFILE_HASHTAG_EMPTY");
 return parts.map(part=>"#"+part).join(" ");
}
