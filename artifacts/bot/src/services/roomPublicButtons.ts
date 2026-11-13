/** Public Room+募集 action policy. Do not expose meeting join before LIVE,
 * and do not duplicate an approval application with an owner-contact button.
 * All URLs are opaque Bot DM links or already verified public profile URLs.
 */
import type {RoomTarget} from "./roomCrossPost.js";

export type RoomPublicButton={text:string;url:string};
export function roomPublicButtons(args:{
 visibility:"public"|"approved_only";
 state:"draft"|"scheduled"|"ready"|"postponed"|"live"|"finished"|"cancelled";
 applicationUrl?:string;
 joinUrl?:string;
 profileUrl?:string;
}):RoomPublicButton[]{
 const result:RoomPublicButton[]=[];
 const active=!["finished","cancelled"].includes(args.state);
 if(active&&args.visibility==="approved_only"){
  if(!args.applicationUrl)throw Error("ROOM_APPLICATION_URL_REQUIRED");
  result.push({text:"📝 応募する",url:args.applicationUrl});
 }
 if(args.state==="live"){
  if(!args.joinUrl)throw Error("ROOM_JOIN_URL_REQUIRED");
  result.push({text:"🎥 参加する",url:args.joinUrl});
 }
 if(active&&args.profileUrl)result.push({text:"🪪 プロフを見る",url:args.profileUrl});
 return result;
}

/** The message is shared by all readers. Final access permission is ALWAYS
 * checked again by the existing private-DM roomAccess gate.
 */
export function transitionRoomPublicButtons(
 buttons:readonly (readonly RoomPublicButton[])[],state:string,
):RoomPublicButton[][]{
 const flattened=buttons.flat();
 if(["finished","cancelled"].includes(state))return [];
 if(state!=="live")return flattened.filter(x=>!x.text.includes("参加する")&&
   !x.text.includes("募集者へ連絡")&&x.text!=="募集者に連絡").length?
   [flattened.filter(x=>!x.text.includes("参加する")&&
     !x.text.includes("募集者へ連絡")&&x.text!=="募集者に連絡")]:[];
 return flattened.filter(x=>!x.text.includes("募集者へ連絡")&&
   x.text!=="募集者に連絡").length?
   [flattened.filter(x=>!x.text.includes("募集者へ連絡")&&x.text!=="募集者に連絡")]:[];
}
