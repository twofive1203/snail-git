import { GitCommit, GitBranch, GitTag, FileChange, ShelfItem, StashItem, FileChangeStatus, DiffChunk, DiffLine, GitRepository } from '../types/git';

export const mockRepositories: GitRepository[] = [
  {
    id: 'repo-1',
    name: 'easy-git',
    path: 'D:/workspace/aiwork/easy-git',
    currentBranch: 'main',
    aheadCount: 1,
    behindCount: 0,
    dirtyFilesCount: 13,
    isFavorite: true,
    lastOpened: '刚刚',
  },
  {
    id: 'repo-2',
    name: 'eam-agent',
    path: 'D:/workspace/uinnova/eam-agent',
    currentBranch: 'feature/agent-v2',
    aheadCount: 3,
    behindCount: 1,
    dirtyFilesCount: 5,
    isFavorite: true,
    lastOpened: '2 小时前',
  },
  {
    id: 'repo-3',
    name: 'cloud-gateway',
    path: 'D:/workspace/backend/cloud-gateway',
    currentBranch: 'develop',
    aheadCount: 0,
    behindCount: 0,
    dirtyFilesCount: 0,
    isFavorite: false,
    lastOpened: '昨天 17:30',
  },
  {
    id: 'repo-4',
    name: 'design-system',
    path: 'D:/workspace/frontend/design-system',
    currentBranch: 'main',
    aheadCount: 0,
    behindCount: 2,
    dirtyFilesCount: 2,
    isFavorite: false,
    lastOpened: '3 天前',
  }
];

export const mockBranches: GitBranch[] = [
  {
    name: 'main',
    isCurrent: true,
    isRemote: false,
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    lastCommitHash: 'a71b2d3',
    lastCommitMessage: 'feat(core): 实现高性能 Git 拓扑图谱 SVG 渲染算法',
    isFavorite: true,
  },
  {
    name: 'develop',
    isCurrent: false,
    isRemote: false,
    upstream: 'origin/develop',
    ahead: 0,
    behind: 2,
    lastCommitHash: 'f49c01e',
    lastCommitMessage: 'refactor(diff): 优化双栏 Diff Token 级比对计算',
    isFavorite: true,
  },
  {
    name: 'feature/auth-jwt',
    isCurrent: false,
    isRemote: false,
    ahead: 3,
    behind: 1,
    lastCommitHash: 'c83d5a2',
    lastCommitMessage: 'feat(auth): 新增 JWT 令牌自动刷新与本地存储支持',
    isFavorite: false,
  },
  {
    name: 'feature/fast-index',
    isCurrent: false,
    isRemote: false,
    lastCommitHash: '9a21b33',
    lastCommitMessage: 'perf: 替换原生 libgit2 索引读取，内存占用减少 65%',
    isFavorite: false,
  },
  {
    name: 'hotfix/v1.2.1-ipc',
    isCurrent: false,
    isRemote: false,
    lastCommitHash: '5e87a91',
    lastCommitMessage: 'fix(ipc): 修复 Windows 平台下管道通信长输出挂起问题',
    isFavorite: false,
  },
  {
    name: 'origin/main',
    isCurrent: false,
    isRemote: true,
    lastCommitHash: '3b8112c',
    lastCommitMessage: 'chore(ci): 添加跨平台自动化构建与免签发流水线',
    isFavorite: true,
  },
  {
    name: 'origin/develop',
    isCurrent: false,
    isRemote: true,
    lastCommitHash: 'f49c01e',
    lastCommitMessage: 'refactor(diff): 优化双栏 Diff Token 级比对计算',
    isFavorite: false,
  },
  {
    name: 'origin/feature/auth-jwt',
    isCurrent: false,
    isRemote: true,
    lastCommitHash: 'b12c98e',
    lastCommitMessage: 'feat(auth): 初始提交 OAuth2 与 Token 逻辑结构',
    isFavorite: false,
  },
  {
    name: 'upstream/develop',
    isCurrent: false,
    isRemote: true,
    lastCommitHash: 'f49c01e',
    lastCommitMessage: 'refactor(diff): 优化双栏 Diff Token 级比对计算',
    isFavorite: false,
  }
];

export const mockTags: GitTag[] = [
  { name: 'v1.3.0-rc1', hash: 'a71b2d3', subject: 'feat(core): 实现高性能 Git 拓扑图谱 SVG 渲染算法' },
  { name: 'v1.2.0', hash: '9a21b33', subject: 'perf: 替换原生 libgit2 索引读取，内存占用减少 65%' },
  { name: 'v1.0.0', hash: '2c78a01', subject: 'Initial commit: 创建 easy-git 基础架构与工程脚手架' },
  { name: '6.7-ai分支备份', hash: '5e87a91', subject: 'fix(ipc): 修复 Windows 平台下管道通信长输出挂起问题' },
];

export const mockCommits: GitCommit[] = [
  {
    hash: 'a71b2d399c01ef45a2b1cd567891234a56b789cd',
    shortHash: 'a71b2d3',
    subject: 'feat(core): 实现高性能 Git 拓扑图谱 SVG 渲染算法',
    body: '采用多轨道贝塞尔曲线计算合并与分支分叉，支持万级提交快速虚拟化呈现。\n- 优化节点碰撞检测\n- 降低 DOM 节点数',
    author: 'Li Chong',
    authorEmail: 'lichong@easygit.org',
    date: '2025-05-18 16:42:10',
    relativeDate: '10 分钟前',
    parents: ['3b8112c', 'c83d5a2'],
    refs: ['HEAD -> main', 'tag: v1.3.0-rc1'],
    branchTrack: 0,
    files: [
      { path: 'src/components/CommitGraph.tsx', filename: 'CommitGraph.tsx', status: 'modified', additions: 142, deletions: 18 },
      { path: 'src/core/graphEngine.ts', filename: 'graphEngine.ts', status: 'added', additions: 230, deletions: 0 },
      { path: 'src/types/git.ts', filename: 'git.ts', status: 'modified', additions: 15, deletions: 2 }
    ]
  },
  {
    hash: 'c83d5a281e05ac981f2b3c4d5e6f7a8b9c0d1e2f',
    shortHash: 'c83d5a2',
    subject: 'feat(auth): 新增 JWT 令牌自动刷新与本地存储支持',
    body: '解决 Token 过期导致的无感重连问题，并支持安全的系统凭证链。',
    author: 'Alex Chen',
    authorEmail: 'alex.chen@github.com',
    date: '2025-05-18 15:20:00',
    relativeDate: '1 小时前',
    parents: ['b12c98e'],
    refs: ['feature/auth-jwt'],
    branchTrack: 2,
    files: [
      { path: 'src/auth/tokenManager.ts', filename: 'tokenManager.ts', status: 'added', additions: 98, deletions: 0 },
      { path: 'src/api/client.ts', filename: 'client.ts', status: 'modified', additions: 34, deletions: 8 }
    ]
  },
  {
    hash: '3b8112cc4a7812bcde345678901234567890abcdef',
    shortHash: '3b8112c',
    subject: 'chore(ci): 添加跨平台自动化构建与免签发流水线',
    body: '配置 GitHub Actions 矩阵构建，支持 Windows x64, macOS arm64 和 Linux。',
    author: 'Sarah Jenkins',
    authorEmail: 'sarah.j@devops.org',
    date: '2025-05-18 11:05:43',
    relativeDate: '5 小时前',
    parents: ['f49c01e'],
    refs: ['origin/main'],
    branchTrack: 0,
    files: [
      { path: '.github/workflows/release.yml', filename: 'release.yml', status: 'modified', additions: 64, deletions: 12 },
      { path: 'package.json', filename: 'package.json', status: 'modified', additions: 3, deletions: 1 }
    ]
  },
  {
    hash: 'f49c01e23a45b67c8d9e0f1a2b3c4d5e6f7a8b9c',
    shortHash: 'f49c01e',
    subject: 'refactor(diff): 优化双栏 Diff Token 级比对计算',
    body: '引入 Myers 差异比对算法结合单词粒度 Levenshtein 距离，让行内微小变动一目了然。',
    author: 'Li Chong',
    authorEmail: 'lichong@easygit.org',
    date: '2025-05-17 19:30:15',
    relativeDate: '昨天 19:30',
    parents: ['5e87a91'],
    refs: ['develop', 'origin/develop'],
    branchTrack: 1,
    files: [
      { path: 'src/core/diffCalculator.ts', filename: 'diffCalculator.ts', status: 'modified', additions: 88, deletions: 42 },
      { path: 'src/components/SideBySideDiff.tsx', filename: 'SideBySideDiff.tsx', status: 'modified', additions: 45, deletions: 19 }
    ]
  },
  {
    hash: 'b12c98e12d34e56f7a8b9c0d1e2f3a4b5c6d7e8f',
    shortHash: 'b12c98e',
    subject: 'feat(auth): 初始提交 OAuth2 与 Token 逻辑结构',
    body: '基础数据层接入与接口抽象定义。',
    author: 'Alex Chen',
    authorEmail: 'alex.chen@github.com',
    date: '2025-05-17 14:10:22',
    relativeDate: '昨天 14:10',
    parents: ['5e87a91'],
    refs: ['origin/feature/auth-jwt'],
    branchTrack: 2,
    files: [
      { path: 'src/auth/types.ts', filename: 'types.ts', status: 'added', additions: 55, deletions: 0 }
    ]
  },
  {
    hash: '5e87a91b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f',
    shortHash: '5e87a91',
    subject: 'fix(ipc): 修复 Windows 平台下管道通信长输出挂起问题',
    body: 'Windows 下 stdio 管道在超出 64KB 缓冲区时会导致死锁，改为分块异步读取。',
    author: 'David Wu',
    authorEmail: 'david.wu@system.net',
    date: '2025-05-16 21:05:00',
    relativeDate: '2 天前',
    parents: ['9a21b33'],
    refs: ['hotfix/v1.2.1-ipc'],
    branchTrack: 1,
    files: [
      { path: 'src/platform/win32Pipes.ts', filename: 'win32Pipes.ts', status: 'modified', additions: 28, deletions: 9 }
    ]
  },
  {
    hash: '9a21b33c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
    shortHash: '9a21b33',
    subject: 'perf: 替换原生 libgit2 索引读取，内存占用减少 65%',
    body: '通过流式遍历 Git packfile 和 tree 对象，避免一次性在内存中构建庞大的对象树。',
    author: 'Li Chong',
    authorEmail: 'lichong@easygit.org',
    date: '2025-05-15 17:44:12',
    relativeDate: '3 天前',
    parents: ['2c78a01'],
    refs: ['tag: v1.2.0'],
    branchTrack: 0,
    files: [
      { path: 'src/native/gitReader.ts', filename: 'gitReader.ts', status: 'modified', additions: 190, deletions: 120 },
      { path: 'src/core/memoryMonitor.ts', filename: 'memoryMonitor.ts', status: 'added', additions: 65, deletions: 0 }
    ]
  },
  {
    hash: '2c78a01d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b',
    shortHash: '2c78a01',
    subject: 'Initial commit: 创建 easy-git 基础架构与工程脚手架',
    body: '极致轻量、内存占用 < 80MB 的 IDEA 风格现代化 Git 客户端项目初始化。',
    author: 'Li Chong',
    authorEmail: 'lichong@easygit.org',
    date: '2025-05-10 10:00:00',
    relativeDate: '8 天前',
    parents: [],
    refs: ['tag: v1.0.0'],
    branchTrack: 0,
    files: [
      { path: 'package.json', filename: 'package.json', status: 'added', additions: 45, deletions: 0 },
      { path: 'README.md', filename: 'README.md', status: 'added', additions: 80, deletions: 0 },
      { path: 'vite.config.ts', filename: 'vite.config.ts', status: 'added', additions: 18, deletions: 0 }
    ]
  }
];

export const mockCurrentChanges: FileChange[] = [
  // 1. resources/prompts/delivery/delivery-conversation-system.md
  {
    id: 'f-md-1',
    path: 'eam-agent/src/main/resources/prompts/delivery/delivery-conversation-system.md',
    filename: 'delivery-conversation-system.md',
    status: 'modified',
    additions: 24,
    deletions: 4,
    isStaged: true,
    chunks: [
      {
        id: 'c-md-1',
        oldStart: 12,
        oldLines: 4,
        newStart: 12,
        newLines: 8,
        isStaged: true,
        lines: [
          { type: 'unchanged' as const, oldLineNumber: 12, newLineNumber: 12, oldContent: '## 交互规则定义', newContent: '## 交互规则定义' },
          { type: 'deleted' as const, oldLineNumber: 13, oldContent: '- 默认使用单轮对话响应' },
          { type: 'added' as const, newLineNumber: 13, newContent: '- 默认启用多轮上下文智能记忆机制' },
          { type: 'added' as const, newLineNumber: 14, newContent: '- 严格遵循本体构建能力规范约束' },
          { type: 'unchanged' as const, oldLineNumber: 14, newLineNumber: 15, oldContent: '### 响应结构', newContent: '### 响应结构' },
        ]
      }
    ]
  },
  // 2. resources/delivery-schemas/ontology-capability-builder/schemas/ontology-capability-result.schema.json
  {
    id: 'f-json-1',
    path: 'eam-agent/src/main/resources/delivery-schemas/ontology-capability-builder/schemas/ontology-capability-result.schema.json',
    filename: 'ontology-capability-result.schema.json',
    status: 'modified' as const,
    additions: 15,
    deletions: 2,
    isStaged: true,
    chunks: [
      {
        id: 'c-json-1',
        oldStart: 40,
        oldLines: 3,
        newStart: 40,
        newLines: 6,
        isStaged: true,
        lines: [
          { type: 'unchanged' as const, oldLineNumber: 40, newLineNumber: 40, oldContent: '    "capabilityType": { "type": "string" },', newContent: '    "capabilityType": { "type": "string" },' },
          { type: 'deleted' as const, oldLineNumber: 41, oldContent: '    "status": { "type": "string" }' },
          { type: 'added' as const, newLineNumber: 41, newContent: '    "status": { "type": "string", "enum": ["ACTIVE", "PENDING"] },' },
          { type: 'added' as const, newLineNumber: 42, newContent: '    "version": { "type": "string" }' },
          { type: 'unchanged' as const, oldLineNumber: 42, newLineNumber: 43, oldContent: '  },', newContent: '  },' }
        ]
      }
    ]
  },
  // 3-13: java/com/uinnova/product/eam/agent 下的 11 个文件
  ...Array.from({ length: 11 }).map((_, i) => {
    const javaFiles = [
      'AgentExecutionService.java',
      'AgentContextManager.java',
      'OntologyBuilderController.java',
      'ConversationPipeline.java',
      'PromptTemplateEngine.java',
      'CapabilityRegistry.java',
      'AgentEventListener.java',
      'DeliveryAuditLogger.java',
      'AgentSessionCache.java',
      'AgentConfigProperties.java',
      'AgentBootstrap.java',
    ];
    const name = javaFiles[i];
    return {
      id: `f-java-${i + 1}`,
      path: `eam-agent/src/main/java/com/uinnova/product/eam/agent/${name}`,
      filename: name,
      status: (i === 0 ? 'added' : 'modified') as FileChangeStatus,
      additions: 12 + i * 5,
      deletions: i % 2 === 0 ? 3 + i : 0,
      isStaged: true,
      chunks: [
        {
          id: `c-java-${i}-1`,
          oldStart: 15,
          oldLines: 4,
          newStart: 15,
          newLines: 6,
          isStaged: true,
          lines: [
            { type: 'unchanged' as const, oldLineNumber: 15, newLineNumber: 15, oldContent: 'package com.uinnova.product.eam.agent;', newContent: 'package com.uinnova.product.eam.agent;' },
            { type: 'unchanged' as const, oldLineNumber: 16, newLineNumber: 16, oldContent: 'import lombok.extern.slf4j.Slf4j;', newContent: 'import lombok.extern.slf4j.Slf4j;' },
            { type: 'added' as const, newLineNumber: 17, newContent: 'import com.uinnova.product.eam.agent.model.CapabilityContext;' },
            { type: 'unchanged' as const, oldLineNumber: 17, newLineNumber: 18, oldContent: '@Slf4j', newContent: '@Slf4j' }
          ]
        }
      ]
    };
  }),

  // 未进行版本管理的文件 (64 个文件分布在 4 个子模块)
  // eam 25 个文件
  ...Array.from({ length: 25 }).map((_, i) => ({
    id: `untracked-eam-${i}`,
    path: `eam/temp/unversioned_file_${i + 1}.log`,
    filename: `unversioned_file_${i + 1}.log`,
    status: 'untracked' as FileChangeStatus,
    additions: 10,
    deletions: 0,
    isStaged: false,
    chunks: []
  })),
  // eam-agent 36 个文件
  ...Array.from({ length: 36 }).map((_, i) => ({
    id: `untracked-agent-${i}`,
    path: `eam-agent/build/target/classes/cache_${i + 1}.tmp`,
    filename: `cache_${i + 1}.tmp`,
    status: 'untracked' as FileChangeStatus,
    additions: 10,
    deletions: 0,
    isStaged: false,
    chunks: []
  })),
  // eam-opencode 1 个文件
  {
    id: 'untracked-opencode-0',
    path: 'eam-opencode/settings.local.json',
    filename: 'settings.local.json',
    status: 'untracked' as FileChangeStatus,
    additions: 20,
    deletions: 0,
    isStaged: false,
    chunks: []
  },
  // eam-web 2 个文件
  {
    id: 'untracked-web-0',
    path: 'eam-web/dist/bundle.js',
    filename: 'bundle.js',
    status: 'untracked' as FileChangeStatus,
    additions: 100,
    deletions: 0,
    isStaged: false,
    chunks: []
  },
  {
    id: 'untracked-web-1',
    path: 'eam-web/dist/bundle.css',
    filename: 'bundle.css',
    status: 'untracked' as FileChangeStatus,
    additions: 50,
    deletions: 0,
    isStaged: false,
    chunks: []
  }
];


export const mockShelves: ShelfItem[] = [
  {
    id: 'shelf-1',
    name: 'WIP: 自定义快捷键绑定与 Vim 模式支持',
    date: '2025-05-18 10:15',
    fileCount: 3,
    files: [
      { path: 'src/keymap/vimBindings.ts', status: 'modified', additions: 110, deletions: 20 },
      { path: 'src/keymap/config.json', status: 'modified', additions: 15, deletions: 5 },
      { path: 'src/ui/KeymapSettings.tsx', status: 'added', additions: 92, deletions: 0 }
    ]
  },
  {
    id: 'shelf-2',
    name: '暂存：重构跨平台路径兼容性测试',
    date: '2025-05-16 14:02',
    fileCount: 1,
    files: [
      { path: 'tests/platform/path.test.ts', status: 'modified', additions: 44, deletions: 12 }
    ]
  }
];

export const mockStashes: StashItem[] = [
  {
    id: 'stash-1',
    index: 0,
    message: 'WIP on main: a71b2d3 实现高性能 Git 拓扑图谱 SVG 渲染算法',
    branch: 'main',
    date: '2025-05-18 16:10',
    fileCount: 4
  },
  {
    id: 'stash-2',
    index: 1,
    message: 'On develop: 尝试使用 wasm-git 加速差异分析',
    branch: 'develop',
    date: '2025-05-15 09:30',
    fileCount: 2
  }
];
