// 每行只记一个 branchTrack 不够画连线：旁支提交会把主线打断，合并线也接不到真正的父提交。
// 这里按 parents 重算轨道，保证子提交到父提交的线在行边界上对得上。

export interface GraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
}

export type GraphY = 'top' | 'mid' | 'bottom';

export interface GraphLink {
  fromLane: number;
  toLane: number;
  fromY: GraphY;
  toY: GraphY;
  color: number;
  /** 分叉 / 汇入才画箭头，直行不画，避免每行一个箭头把点挤乱。 */
  arrow: boolean;
}

export interface GraphRow {
  commitLane: number;
  commitColor: number;
  links: GraphLink[];
}

export interface GraphLayout {
  rows: GraphRow[];
  laneCount: number;
}

export const TRACK_COLORS = [
  '#3574F0',
  '#59A869',
  '#B388FF',
  '#EDA200',
  '#29B6F6',
  '#E35967',
];

export const LANE_WIDTH = 14;
export const LANE_PAD = 16;

const PALETTE = TRACK_COLORS.length;

interface Lane {
  target: string;
  color: number;
}

export function laneCenter(lane: number): number {
  return LANE_PAD + lane * LANE_WIDTH;
}

export function graphColumnWidth(laneCount: number): number {
  const lanes = Math.max(1, laneCount);
  return Math.max(48, LANE_PAD + (lanes - 1) * LANE_WIDTH + LANE_PAD);
}

function pickColor(lanes: Array<Lane | null>, avoid: number[] = []): number {
  const used = new Set<number>(avoid);
  for (const lane of lanes) {
    if (lane) used.add(lane.color);
  }
  for (let i = 0; i < PALETTE; i++) {
    if (!used.has(i)) return i;
  }
  for (let i = 0; i < PALETTE; i++) {
    if (!avoid.includes(i)) return i;
  }
  return 0;
}

function resolveParent(commits: GraphCommit[], parent: string): string | null {
  if (!parent) return null;
  for (const commit of commits) {
    if (commit.hash === parent || commit.shortHash === parent) return commit.hash;
  }
  if (parent.length < 4) return null;
  for (const commit of commits) {
    if (commit.hash.startsWith(parent) || parent.startsWith(commit.hash)) return commit.hash;
  }
  return null;
}

function allocRight(lanes: Array<Lane | null>, from: number): number {
  for (let i = from + 1; i < lanes.length; i++) {
    if (!lanes[i]) return i;
  }
  lanes.push(null);
  return lanes.length - 1;
}

function compactLanes(lanes: Array<Lane | null>): { lanes: Lane[]; map: number[] } {
  const map: number[] = [];
  const next: Lane[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    if (lane) {
      map[i] = next.length;
      next.push(lane);
    } else {
      map[i] = -1;
    }
  }
  return { lanes: next, map };
}

export function layoutGraph(commits: GraphCommit[]): GraphLayout {
  const indexByHash = new Map(commits.map((commit, index) => [commit.hash, index]));
  let lanes: Lane[] = [];
  const rows: GraphRow[] = [];
  let maxLane = 0;

  for (let index = 0; index < commits.length; index++) {
    const commit = commits[index];
    const seen = new Set<string>();
    const parents: string[] = [];
    for (const raw of commit.parents) {
      const resolved = resolveParent(commits, raw);
      if (!resolved || seen.has(resolved)) continue;
      const parentIndex = indexByHash.get(resolved);
      // 父提交必须在更下面。窗口外或被筛掉的父提交不连，避免接到错误的点上。
      if (parentIndex === undefined || parentIndex <= index) continue;
      seen.add(resolved);
      parents.push(resolved);
    }

    const incoming: Array<Lane | null> = lanes.map(lane => ({ ...lane }));
    const matches: number[] = [];
    for (let lane = 0; lane < incoming.length; lane++) {
      if (incoming[lane]?.target === commit.hash) matches.push(lane);
    }

    let commitLane: number;
    let commitColor: number;
    const links: GraphLink[] = [];

    if (matches.length === 0) {
      commitLane = incoming.length;
      incoming.push(null);
      commitColor = pickColor(incoming);
    } else {
      commitLane = matches[0];
      commitColor = incoming[commitLane]!.color;
      links.push({
        fromLane: commitLane,
        toLane: commitLane,
        fromY: 'top',
        toY: 'mid',
        color: commitColor,
        arrow: false,
      });
      for (const lane of matches.slice(1)) {
        links.push({
          fromLane: lane,
          toLane: commitLane,
          fromY: 'top',
          toY: 'mid',
          color: incoming[lane]!.color,
          arrow: true,
        });
      }
    }

    const outgoing: Array<Lane | null> = incoming.map(lane => (lane ? { ...lane } : null));
    for (const lane of matches) outgoing[lane] = null;

    const firstParent = parents[0];
    if (firstParent) {
      outgoing[commitLane] = { target: firstParent, color: commitColor };
      links.push({
        fromLane: commitLane,
        toLane: commitLane,
        fromY: 'mid',
        toY: 'bottom',
        color: commitColor,
        arrow: false,
      });
    }

    // 第二父提交单独占右侧轨道，一直画到那个提交再汇入。
    // 如果提前拐到已有轨道，中间的提交会被画成错误的合并点。
    for (const parent of parents.slice(1)) {
      const slot = allocRight(outgoing, commitLane);
      const color = pickColor(outgoing, [commitColor]);
      outgoing[slot] = { target: parent, color };
      links.push({
        fromLane: commitLane,
        toLane: slot,
        fromY: 'mid',
        toY: 'bottom',
        color,
        arrow: true,
      });
    }

    for (let lane = 0; lane < incoming.length; lane++) {
      const current = incoming[lane];
      const next = outgoing[lane];
      if (!current || !next || matches.includes(lane)) continue;
      if (next.target !== current.target || next.color !== current.color) continue;
      links.push({
        fromLane: lane,
        toLane: lane,
        fromY: 'top',
        toY: 'bottom',
        color: current.color,
        arrow: false,
      });
    }

    const compacted = compactLanes(outgoing);
    for (const link of links) {
      if (link.toY !== 'bottom') continue;
      const mapped = compacted.map[link.toLane];
      if (mapped === undefined || mapped < 0) continue;
      link.toLane = mapped;
    }

    maxLane = Math.max(maxLane, commitLane);
    for (const link of links) {
      maxLane = Math.max(maxLane, link.fromLane, link.toLane);
    }

    rows.push({ commitLane, commitColor, links });
    lanes = compacted.lanes;
  }

  return {
    rows,
    laneCount: maxLane + 1,
  };
}
