// Short on-bridge explanations for unsolved structures. A singular truss has no
// trustworthy member forces, so these never claim a member broke.
export function instabilityStory(diagnosis) {
  const d=diagnosis||{};
  const nodeIds=d.affectedNodeIds?.length?d.affectedNodeIds:d.nodeId==null?[]:[d.nodeId];
  const memberId=d.memberId??null;
  switch(d.kind) {
    case 'pass_through': return {title:`OPEN JOINT ${d.nodeId+1}`,cause:`Member ${memberId+1} crosses here but does not connect.`,fix:'Draw two members ending at this joint.',nodeIds,memberId};
    case 'empty': return {title:'NO LOAD PATH',cause:'The deck has no structural members to carry weight.',fix:'Add members and triangles to both supports.',nodeIds,memberId};
    case 'isolated_joint': return {title:`LOOSE JOINT ${d.nodeId+1}`,cause:'This joint has no connected members.',fix:'Connect this joint or remove it.',nodeIds,memberId};
    case 'disconnected': return {title:'UNSUPPORTED GROUP',cause:'These joints have no path to either support.',fix:'Connect this group to the supported span.',nodeIds,memberId};
    case 'missing_deck_chord': return {title:'MISSING BOTTOM CHORD',cause:'The road is drawn but is not a truss member.',fix:'Add members along the marked deck spans.',nodeIds,memberId};
    case 'frame_mechanism': return {title:'UNRESTRAINED JOINTS',cause:'This part can move despite beam bending stiffness.',fix:'Check hinges, supports, and missing connections.',nodeIds,memberId};
    case 'mechanism': return {title:'MOVING JOINTS',cause:'These joints can move without stretching members.',fix:'Add a diagonal to brace the moving section.',nodeIds,memberId};
    case 'unresolved': return {title:'SOLVER COULD NOT RESOLVE',cause:d.message,fix:d.advice,nodeIds,memberId};
    default: return {title:'NO STABLE LOAD PATH',cause:d.message||'The structure cannot carry the load.',fix:d.advice||'Connect and brace the bridge.',nodeIds,memberId};
  }
}
