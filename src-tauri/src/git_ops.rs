use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeDto {
    pub id: String,
    pub path: String,
    pub old_path: Option<String>,
    pub filename: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub is_staged: bool,
    pub chunks: Vec<DiffChunkDto>,
    pub chunks_loaded: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffChunkDto {
    pub id: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub is_staged: bool,
    pub lines: Vec<DiffLineDto>,
    pub raw_patch: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLineDto {
    #[serde(rename = "type")]
    pub kind: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDto {
    pub path: String,
    pub filename: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDto {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub body: Option<String>,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub relative_date: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub branch_track: u32,
    pub files: Vec<CommitFileDto>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchDto {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub last_commit_hash: String,
    pub last_commit_message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashItemDto {
    pub id: String,
    pub index: u32,
    pub message: String,
    pub branch: String,
    pub date: String,
    pub file_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShelfFileDto {
    pub path: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItemDto {
    pub id: String,
    pub name: String,
    pub date: String,
    pub file_count: u32,
    pub files: Vec<ShelfFileDto>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRepoDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub current_branch: String,
    pub ahead_count: u32,
    pub behind_count: u32,
    pub dirty_files_count: u32,
    pub is_favorite: bool,
    pub last_opened: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedRepoDisk {
    id: String,
    name: String,
    path: String,
    is_favorite: bool,
    last_opened: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshot {
    pub current_branch: String,
    pub head_hash: String,
    pub ahead_count: u32,
    pub behind_count: u32,
    pub dirty_files_count: u32,
    pub git_version: String,
    pub changes: Vec<FileChangeDto>,
    pub commits: Vec<GitCommitDto>,
    pub branches: Vec<GitBranchDto>,
    pub stashes: Vec<StashItemDto>,
    pub shelves: Vec<ShelfItemDto>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ShelfDisk {
    id: String,
    name: String,
    date: String,
    files: Vec<ShelfFileDto>,
    patch: String,
    new_files: Vec<NewFileDisk>,
}

#[derive(Debug, Serialize, Deserialize)]
struct NewFileDisk {
    path: String,
    content: String,
}

fn ensure_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("create {}: {err}", dir.display()))?;
    let probe = dir.join(".write-probe");
    fs::write(&probe, b"ok").map_err(|err| format!("write {}: {err}", probe.display()))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

pub fn writable_data_dir() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("EasyGit"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("easy-git-data"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("target").join("easy-git-data"));
    }
    let mut errors = Vec::new();
    for dir in candidates {
        match ensure_writable(&dir) {
            Ok(()) => return Ok(dir),
            Err(err) => errors.push(err),
        }
    }
    Err(if errors.is_empty() {
        "没有可写的应用数据目录".into()
    } else {
        errors.join("; ")
    })
}

fn repos_file() -> Result<PathBuf, String> {
    Ok(writable_data_dir()?.join("repos.json"))
}

fn shelf_dir(repo_path: &str) -> Result<PathBuf, String> {
    let dir = writable_data_dir()?.join("shelves").join(repo_id(repo_path));
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建架藏目录：{err}"))?;
    Ok(dir)
}

pub fn repo_id(path: &str) -> String {
    let norm = normalize_path(path);
    let mut hash: u64 = 1469598103934665603;
    for b in norm.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{:016x}", hash)
}

fn normalize_path(path: &str) -> String {
    let mut p = path.replace('/', "\\");
    while p.ends_with('\\') {
        p.pop();
    }
    p.to_lowercase()
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

fn git_base(cwd: &str) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0")
        .args([
            "-c",
            "core.quotepath=false",
            "-c",
            "i18n.logOutputEncoding=utf-8",
        ]);
    cmd
}

fn run_git(cwd: &str, args: &[&str], timeout: Duration) -> Result<Output, String> {
    let mut cmd = git_base(cwd);
    cmd.args(args);
    output_timeout(cmd, timeout)
}

fn output_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 git：{e}。请确认已安装 Git 并加入 PATH。"))?;

    let mut stdout_pipe = child.stdout.take().unwrap();
    let mut stderr_pipe = child.stderr.take().unwrap();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = out_handle.join().unwrap_or_default();
                let stderr = err_handle.join().unwrap_or_default();
                return Ok(Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Git 命令超时。若是推送/拉取，请先在终端完成凭据登录后再试。".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn ensure_ok(output: &Output, action: &str) -> Result<String, String> {
    if output.status.success() {
        Ok(lossy(&output.stdout))
    } else {
        let err = lossy(&output.stderr);
        let out = lossy(&output.stdout);
        let msg = if err.is_empty() { out } else { err };
        Err(if msg.is_empty() {
            format!("{action}失败")
        } else {
            format!("{action}失败：{msg}")
        })
    }
}

pub fn validate_repo(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err("目录不存在".into());
    }
    let output = run_git(path, &["rev-parse", "--show-toplevel"], Duration::from_secs(8))?;
    let top = ensure_ok(&output, "识别仓库")?;
    if top.is_empty() {
        return Err("不是 Git 仓库".into());
    }
    Ok(top.replace('/', "\\"))
}

fn recycle_inside_repo(repo: &str, full: &Path) -> Result<(), String> {
    let canon = fs::canonicalize(full).map_err(|e| format!("无法定位文件：{e}"))?;
    let root = fs::canonicalize(repo).map_err(|e| e.to_string())?;
    if !canon.starts_with(&root) {
        return Err("拒绝删除仓库外文件".into());
    }
    recycle_file(&canon)
}

fn recycle_file(path: &Path) -> Result<(), String> {
    let display = path.display().to_string();
    let plain = display.strip_prefix(r"\\?\").unwrap_or(&display);
    let escaped = plain.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("无法把文件移入回收站：{e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("移入回收站失败：{}", lossy(&output.stderr)))
    }
}

fn safe_rel(path: &str) -> Result<String, String> {
    let p = path.replace('\\', "/");
    if p.starts_with('/') || p.contains(':') || p.split('/').any(|s| s == "..") {
        return Err(format!("拒绝不安全路径：{path}"));
    }
    Ok(p)
}

fn filename_of(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string()
}

fn map_xy(x: char, y: char) -> (String, bool) {
    if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
        return ("conflict".into(), false);
    }
    if x == '?' || y == '?' {
        return ("untracked".into(), false);
    }
    let staged = x != ' ' && x != '?';
    let code = if y != ' ' && y != '?' { y } else { x };
    let status = match code {
        'A' => "added",
        'D' => "deleted",
        'U' => "conflict",
        _ => "modified",
    };
    (status.into(), staged)
}

pub fn status_files(repo: &str) -> Result<Vec<FileChangeDto>, String> {
    let output = run_git(
        repo,
        &["status", "--porcelain=v1", "-z", "-uall"],
        Duration::from_secs(20),
    )?;
    if !output.status.success() {
        return Err(format!("读取状态失败：{}", lossy(&output.stderr)));
    }
    let parts: Vec<String> = output
        .stdout
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect();

    let mut files = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let entry = &parts[i];
        if entry.len() < 3 {
            i += 1;
            continue;
        }
        let x = entry.chars().next().unwrap_or(' ');
        let y = entry.chars().nth(1).unwrap_or(' ');
        let path = entry[3..].to_string();
        let mut display = path.clone();
        let mut old_path = None;
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            i += 1;
            if i < parts.len() {
                // git 2.34 porcelain -z 的第一段是当前路径，第二段才是原路径。
                display = path;
                old_path = Some(parts[i].clone());
            }
        }
        i += 1;
        let (status, is_staged) = map_xy(x, y);
        files.push(FileChangeDto {
            id: display.replace('\\', "/"),
            filename: filename_of(&display),
            path: display,
            old_path,
            status,
            additions: 0,
            deletions: 0,
            is_staged,
            chunks: Vec::new(),
            chunks_loaded: false,
        });
    }
    Ok(files)
}

pub fn signature(repo: &str) -> String {
    match run_git(
        repo,
        &["status", "--porcelain=v1", "-uall"],
        Duration::from_secs(8),
    ) {
        Ok(out) => {
            let head = run_git(repo, &["rev-parse", "HEAD"], Duration::from_secs(5))
                .ok()
                .map(|o| lossy(&o.stdout))
                .unwrap_or_default();
            format!("{head}\n{}", lossy(&out.stdout))
        }
        Err(_) => String::new(),
    }
}

fn ahead_behind(repo: &str) -> (u32, u32) {
    let output = run_git(
        repo,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        Duration::from_secs(8),
    );
    let Ok(output) = output else { return (0, 0) };
    if !output.status.success() {
        return (0, 0);
    }
    let text = lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let ahead = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let behind = parts.next().unwrap_or("0").parse().unwrap_or(0);
    (ahead, behind)
}

fn current_branch(repo: &str) -> Result<(String, String), String> {
    let output = run_git(
        repo,
        &["rev-parse", "--abbrev-ref", "HEAD"],
        Duration::from_secs(8),
    )?;
    let branch = ensure_ok(&output, "读取分支")?;
    let head = run_git(repo, &["rev-parse", "--short", "HEAD"], Duration::from_secs(8))
        .ok()
        .and_then(|o| ensure_ok(&o, "读取 HEAD").ok())
        .unwrap_or_default();
    Ok((branch, head))
}

pub fn git_log(repo: &str) -> Result<Vec<GitCommitDto>, String> {
    let output = run_git(
        repo,
        &[
            "log",
            "--all",
            "--date-order",
            "-n",
            "200",
            "--name-status",
            "--date=format:%Y-%m-%d %H:%M:%S",
            "--pretty=format:COMMIT%x1f%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%ar%x1f%D%x1f%s%x1f%b%x1e",
        ],
        Duration::from_secs(25),
    )?;
    let text = ensure_ok(&output, "读取提交历史")?;
    let mut commits = Vec::new();
    for block in text.split("COMMIT\x1f") {
        if block.trim().is_empty() {
            continue;
        }
        let (meta, rest) = block.split_once('\x1e').unwrap_or((block, ""));
        let fields: Vec<&str> = meta.split('\x1f').collect();
        if fields.len() < 9 {
            continue;
        }
        let parents = fields[2]
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        let refs = fields[7]
            .split(", ")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        let body = if fields.len() > 9 {
            let b = fields[9..].join("\x1f").trim().to_string();
            if b.is_empty() { None } else { Some(b) }
        } else {
            None
        };
        let mut files = Vec::new();
        for line in rest.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut cols = line.split('\t');
            let code = cols.next().unwrap_or("");
            let path = cols.next().unwrap_or("").to_string();
            if path.is_empty() {
                continue;
            }
            let new_path = cols.next().unwrap_or("").to_string();
            let display = if new_path.is_empty() { path } else { new_path };
            let status = match code.chars().next().unwrap_or('M') {
                'A' => "added",
                'D' => "deleted",
                'U' => "conflict",
                _ => "modified",
            };
            files.push(CommitFileDto {
                filename: filename_of(&display),
                path: display,
                status: status.into(),
                additions: 0,
                deletions: 0,
            });
        }
        commits.push(GitCommitDto {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            subject: fields[8].to_string(),
            body,
            author: fields[3].to_string(),
            author_email: fields[4].to_string(),
            date: fields[5].to_string(),
            relative_date: fields[6].to_string(),
            parents,
            refs,
            branch_track: 0,
            files,
        });
    }
    assign_tracks(&mut commits);
    Ok(commits)
}

fn assign_tracks(commits: &mut [GitCommitDto]) {
    let mut lanes: Vec<Option<String>> = Vec::new();
    for commit in commits.iter_mut() {
        let found = lanes.iter().position(|l| l.as_deref() == Some(commit.hash.as_str()));
        let lane = if let Some(i) = found {
            i
        } else if let Some(i) = lanes.iter().position(|l| l.is_none()) {
            i
        } else {
            lanes.push(None);
            lanes.len() - 1
        };
        if let Some(parent) = commit.parents.first() {
            lanes[lane] = Some(parent.clone());
        } else {
            lanes[lane] = None;
        }
        for parent in commit.parents.iter().skip(1) {
            if let Some(free) = lanes.iter().position(|l| l.is_none()) {
                lanes[free] = Some(parent.clone());
            } else {
                lanes.push(Some(parent.clone()));
            }
        }
        commit.branch_track = lane as u32;
    }
}

pub fn list_branches(repo: &str, current: &str) -> Result<Vec<GitBranchDto>, String> {
    let output = run_git(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)\u{1f}%(objectname:short)\u{1f}%(subject)",
            "refs/heads",
            "refs/remotes",
        ],
        Duration::from_secs(15),
    )?;
    let text = ensure_ok(&output, "读取分支")?;
    let (ahead, behind) = ahead_behind(repo);
    let mut branches = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\x1f');
        let refname = cols.next().unwrap_or("");
        let hash = cols.next().unwrap_or("").to_string();
        let subject = cols.next().unwrap_or("").to_string();
        if refname.ends_with("/HEAD") {
            continue;
        }
        let (name, is_remote) = if let Some(n) = refname.strip_prefix("refs/heads/") {
            (n.to_string(), false)
        } else if let Some(n) = refname.strip_prefix("refs/remotes/") {
            (n.to_string(), true)
        } else {
            continue;
        };
        let is_current = !is_remote && name == current;
        branches.push(GitBranchDto {
            ahead: if is_current { Some(ahead) } else { None },
            behind: if is_current { Some(behind) } else { None },
            is_current,
            is_remote,
            upstream: None,
            last_commit_hash: hash,
            last_commit_message: subject,
            name,
        });
    }
    Ok(branches)
}

pub fn list_stashes(repo: &str) -> Result<Vec<StashItemDto>, String> {
    let output = run_git(
        repo,
        &["stash", "list", "--pretty=format:%gd%x1f%gs%x1f%ci"],
        Duration::from_secs(10),
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let text = lossy(&output.stdout);
    let mut items = Vec::new();
    for (idx, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\x1f');
        let gd = cols.next().unwrap_or("");
        let message = cols.next().unwrap_or("").to_string();
        let date = cols.next().unwrap_or("").to_string();
        let branch = message
            .split("on ")
            .nth(1)
            .and_then(|s| s.split(':').next())
            .unwrap_or("")
            .trim()
            .to_string();
        let index = gd
            .trim_start_matches("stash@{")
            .trim_end_matches('}')
            .parse()
            .unwrap_or(idx as u32);
        let file_count = run_git(
            repo,
            &["stash", "show", "--name-only", &format!("stash@{{{index}}}")],
            Duration::from_secs(8),
        )
        .ok()
        .map(|o| {
            lossy(&o.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count() as u32
        })
        .unwrap_or(0);
        items.push(StashItemDto {
            id: format!("stash-{index}"),
            index,
            message,
            branch,
            date,
            file_count,
        });
    }
    Ok(items)
}

pub fn load_snapshot(repo: &str) -> Result<RepoSnapshot, String> {
    let top = validate_repo(repo)?;
    let (branch, head) = current_branch(&top)?;
    let changes = status_files(&top)?;
    let (ahead, behind) = ahead_behind(&top);
    let version = run_git(&top, &["--version"], Duration::from_secs(5))
        .ok()
        .and_then(|o| ensure_ok(&o, "git version").ok())
        .unwrap_or_else(|| "git".into());
    Ok(RepoSnapshot {
        dirty_files_count: changes.len() as u32,
        commits: git_log(&top).unwrap_or_default(),
        branches: list_branches(&top, &branch).unwrap_or_default(),
        stashes: list_stashes(&top).unwrap_or_default(),
        shelves: list_shelves(&top).unwrap_or_default(),
        current_branch: branch,
        head_hash: head,
        ahead_count: ahead,
        behind_count: behind,
        git_version: version,
        changes,
    })
}

fn split_hunks(diff_text: &str, staged: bool, id_prefix: &str) -> Vec<DiffChunkDto> {
    if diff_text.contains("Binary files") || diff_text.contains("GIT binary patch") {
        return Vec::new();
    }
    let preamble_end = diff_text.find("@@").unwrap_or(diff_text.len());
    let preamble = diff_text[..preamble_end].to_string();
    let body = &diff_text[preamble_end..];
    if body.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut current_header = String::new();
    let mut current_lines: Vec<&str> = Vec::new();
    let flush = |header: &str, lines: &[&str], chunks: &mut Vec<DiffChunkDto>| {
        if header.is_empty() {
            return;
        }
        if let Some(chunk) = parse_hunk(header, lines, staged, id_prefix, chunks.len(), &preamble) {
            chunks.push(chunk);
        }
    };
    for line in body.lines() {
        if line.starts_with("@@") {
            flush(&current_header, &current_lines, &mut chunks);
            current_header = line.to_string();
            current_lines.clear();
        } else if !current_header.is_empty() {
            current_lines.push(line);
        }
    }
    flush(&current_header, &current_lines, &mut chunks);
    chunks
}

fn parse_hunk(
    header: &str,
    raw_lines: &[&str],
    staged: bool,
    id_prefix: &str,
    index: usize,
    preamble: &str,
) -> Option<DiffChunkDto> {
    // @@ -l,s +l,s @@
    let spec = header.trim_start_matches("@@").trim();
    let spec = spec.split("@@").next().unwrap_or("").trim();
    let mut parts = spec.split_whitespace();
    let old = parts.next().unwrap_or("-0,0");
    let new = parts.next().unwrap_or("+0,0");
    let (old_start, old_lines) = parse_range(old);
    let (new_start, new_lines) = parse_range(new);
    let mut lines = Vec::new();
    let mut old_no = old_start;
    let mut new_no = new_start;
    let mut patch_body = String::new();
    for line in raw_lines {
        if line.starts_with('\\') {
            continue;
        }
        patch_body.push_str(line);
        patch_body.push('\n');
        if line.starts_with('+') {
            lines.push(DiffLineDto {
                kind: "added".into(),
                old_line_number: None,
                new_line_number: Some(new_no),
                old_content: None,
                new_content: Some(line[1..].to_string()),
            });
            new_no += 1;
        } else if line.starts_with('-') {
            lines.push(DiffLineDto {
                kind: "deleted".into(),
                old_line_number: Some(old_no),
                new_line_number: None,
                old_content: Some(line[1..].to_string()),
                new_content: None,
            });
            old_no += 1;
        } else {
            let content = line.strip_prefix(' ').unwrap_or(line);
            lines.push(DiffLineDto {
                kind: "unchanged".into(),
                old_line_number: Some(old_no),
                new_line_number: Some(new_no),
                old_content: Some(content.to_string()),
                new_content: Some(content.to_string()),
            });
            old_no += 1;
            new_no += 1;
        }
    }
    let preamble = preamble
        .lines()
        .filter(|line| !line.starts_with("index "))
        .collect::<Vec<_>>()
        .join("\n");
    let preamble = if preamble.is_empty() { String::new() } else { format!("{preamble}\n") };
    let raw_patch = format!("{preamble}{header}\n{patch_body}");
    Some(DiffChunkDto {
        id: format!("{id_prefix}-{index}-{old_start}-{new_start}"),
        old_start,
        old_lines,
        new_start,
        new_lines,
        is_staged: staged,
        lines,
        raw_patch,
    })
}

fn parse_range(token: &str) -> (u32, u32) {
    let t = token.trim_start_matches(['-', '+']);
    let mut parts = t.split(',');
    let start = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let count = parts.next().unwrap_or("1").parse().unwrap_or(1);
    (start, count)
}

pub fn file_diff(repo: &str, path: &str) -> Result<Vec<DiffChunkDto>, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let status = status_files(&top)?;
    let file = status.iter().find(|f| f.path.replace('\\', "/") == rel.replace('\\', "/"));
    let is_untracked = file.map(|f| f.status == "untracked").unwrap_or(false);
    if is_untracked {
        return Ok(untracked_chunks(&top, &rel));
    }
    let unstaged = run_git(
        &top,
        &["diff", "-U3", "--", &rel],
        Duration::from_secs(15),
    )?;
    let staged = run_git(
        &top,
        &["diff", "--cached", "-U3", "--", &rel],
        Duration::from_secs(15),
    )?;
    let mut chunks = split_hunks(&lossy(&unstaged.stdout), false, "u");
    chunks.extend(split_hunks(&lossy(&staged.stdout), true, "s"));
    if chunks.is_empty() {
        let head = run_git(&top, &["diff", "-U3", "HEAD", "--", &rel], Duration::from_secs(15))?;
        chunks = split_hunks(&lossy(&head.stdout), false, "h");
    }
    for chunk in &mut chunks {
        if chunk.lines.len() > 800 {
            chunk.lines.truncate(800);
        }
    }
    Ok(chunks)
}

fn untracked_chunks(repo: &str, rel: &str) -> Vec<DiffChunkDto> {
    let full = Path::new(repo).join(rel);
    let bytes = fs::read(&full).unwrap_or_default();
    if bytes.len() > 200_000 || bytes.contains(&0) {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = Vec::new();
    let mut patch = format!("diff --git a/{rel} b/{rel}\nnew file mode 100644\n--- /dev/null\n+++ b/{rel}\n");
    let content_lines: Vec<&str> = text.lines().take(300).collect();
    let count = content_lines.len() as u32;
    patch.push_str(&format!("@@ -0,0 +1,{count} @@\n"));
    for (i, line) in content_lines.iter().enumerate() {
        patch.push('+');
        patch.push_str(line);
        patch.push('\n');
        lines.push(DiffLineDto {
            kind: "added".into(),
            old_line_number: None,
            new_line_number: Some(i as u32 + 1),
            old_content: None,
            new_content: Some((*line).to_string()),
        });
    }
    vec![DiffChunkDto {
        id: format!("new-{rel}"),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: count,
        is_staged: false,
        lines,
        raw_patch: patch,
    }]
}

pub fn stage_paths(repo: &str, paths: &[String]) -> Result<(), String> {
    let top = validate_repo(repo)?;
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    let rels: Vec<String> = paths.iter().map(|p| safe_rel(p)).collect::<Result<_, _>>()?;
    for p in &rels {
        args.push(p);
    }
    let output = run_git(&top, &args, Duration::from_secs(20))?;
    ensure_ok(&output, "暂存")?;
    Ok(())
}

pub fn unstage_paths(repo: &str, paths: &[String]) -> Result<(), String> {
    let top = validate_repo(repo)?;
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["restore", "--staged", "--"];
    let rels: Vec<String> = paths.iter().map(|p| safe_rel(p)).collect::<Result<_, _>>()?;
    for p in &rels {
        args.push(p);
    }
    let output = run_git(&top, &args, Duration::from_secs(20))?;
    ensure_ok(&output, "取消暂存")?;
    Ok(())
}

pub fn discard_paths(repo: &str, paths: &[String]) -> Result<(), String> {
    let top = validate_repo(repo)?;
    let status = status_files(&top)?;
    for path in paths {
        let rel = safe_rel(path)?;
        let file = status.iter().find(|f| f.path.replace('\\', "/") == rel);
        if let Some(old) = file.and_then(|f| f.old_path.clone()) {
            let old_rel = safe_rel(&old)?;
            let restored = run_git(
                &top,
                &["restore", "--source=HEAD", "--worktree", "--staged", "--", &old_rel],
                Duration::from_secs(15),
            )?;
            ensure_ok(&restored, "恢复重命名前的文件")?;
            let _ = run_git(
                &top,
                &["rm", "--cached", "--ignore-unmatch", "--", &rel],
                Duration::from_secs(10),
            );
            let full = Path::new(&top).join(&rel);
            if full.is_file() {
                recycle_inside_repo(&top, &full)?;
            }
            continue;
        }
        let in_head = run_git(
            &top,
            &["cat-file", "-e", &format!("HEAD:{rel}")],
            Duration::from_secs(8),
        )
        .map(|o| o.status.success())
        .unwrap_or(false);
        if file.map(|f| f.status == "untracked").unwrap_or(false) || !in_head {
            let _ = run_git(&top, &["restore", "--staged", "--", &rel], Duration::from_secs(10));
            let full = Path::new(&top).join(&rel);
            if full.is_file() {
                recycle_inside_repo(&top, &full)?;
            }
            continue;
        }
        let output = run_git(
            &top,
            &["restore", "--source=HEAD", "--worktree", "--staged", "--", &rel],
            Duration::from_secs(15),
        )?;
        ensure_ok(&output, "回滚文件")?;
    }
    Ok(())
}

fn run_git_with_stdin(cwd: &str, args: &[&str], stdin_text: &str, timeout: Duration) -> Result<Output, String> {
    let mut cmd = git_base(cwd);
    cmd.args(args).stdin(Stdio::piped());
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 git：{e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(stdin_text.as_bytes()).map_err(|e| e.to_string())?;
    }
    let mut stdout_pipe = child.stdout.take().unwrap();
    let mut stderr_pipe = child.stderr.take().unwrap();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ok(Output {
                    status,
                    stdout: out_handle.join().unwrap_or_default(),
                    stderr: err_handle.join().unwrap_or_default(),
                });
            }
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Git 命令超时。若是推送/拉取，请先在终端完成凭据登录后再试。".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

pub fn apply_chunk(repo: &str, raw_patch: &str, action: &str) -> Result<(), String> {
    let top = validate_repo(repo)?;
    if raw_patch.trim().is_empty() {
        return Err("没有可应用的差异块".into());
    }
    match action {
        "stage" | "unstage" => {
            let mut args = vec!["apply", "--cached", "--unidiff-zero"];
            if action == "unstage" {
                args.insert(1, "-R");
            }
            let output = run_git_with_stdin(&top, &args, raw_patch, Duration::from_secs(15))?;
            ensure_ok(&output, "应用差异块")?;
            Ok(())
        }
        "rollback" => {
            let check = run_git_with_stdin(
                &top,
                &["apply", "--check", "-R", "--unidiff-zero"],
                raw_patch,
                Duration::from_secs(15),
            )?;
            if !check.status.success() {
                return Err("工作区内容和这个差异块不一致，已拒绝回滚，避免覆盖未暂存修改。".into());
            }
            let output = run_git_with_stdin(
                &top,
                &["apply", "-R", "--unidiff-zero"],
                raw_patch,
                Duration::from_secs(15),
            )?;
            ensure_ok(&output, "回滚差异块")?;
            let _ = run_git_with_stdin(
                &top,
                &["apply", "--cached", "--check", "-R", "--unidiff-zero"],
                raw_patch,
                Duration::from_secs(8),
            )
            .and_then(|checked| {
                if checked.status.success() {
                    run_git_with_stdin(
                        &top,
                        &["apply", "--cached", "-R", "--unidiff-zero"],
                        raw_patch,
                        Duration::from_secs(15),
                    )?;
                }
                Ok(())
            });
            Ok(())
        }
        _ => Err("未知块操作".into()),
    }
}

pub fn commit(repo: &str, message: &str, amend: bool, and_push: bool) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let message = message.trim();
    if message.is_empty() {
        return Err("提交说明不能为空".into());
    }
    if amend {
        let published = run_git(
            &top,
            &["rev-list", "--count", "@{upstream}..HEAD"],
            Duration::from_secs(8),
        );
        match published {
            Ok(output) if output.status.success() => {
                let count = lossy(&output.stdout);
                if count == "0" {
                    return Err("这个提交已经推送到上游，拒绝 amend，避免改写已发布历史。".into());
                }
            }
            _ => {}
        }
    }
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    args.push("-m");
    args.push(message);
    let output = run_git(&top, &args, Duration::from_secs(30))?;
    let text = ensure_ok(&output, "提交")?;
    if and_push {
        let push = push(&top);
        match push {
            Ok(pushed) => return Ok(format!("{text}\n{pushed}")),
            Err(err) => return Err(format!("提交已写入，但推送失败：{err}")),
        }
    }
    Ok(text)
}

fn looks_like_hash(name: &str) -> bool {
    (7..=40).contains(&name.len()) && name.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn checkout_branch(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    if name.contains("..") || name.contains(' ') {
        return Err("分支名不合法".into());
    }
    if looks_like_hash(name) {
        let output = run_git(&top, &["switch", "--detach", name], Duration::from_secs(20))?;
        return ensure_ok(&output, "检出提交");
    }
    let local = run_git(
        &top,
        &["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")],
        Duration::from_secs(8),
    )?;
    if local.status.success() {
        let output = run_git(&top, &["switch", "--", name], Duration::from_secs(20))?;
        return ensure_ok(&output, "检出分支");
    }
    if name.starts_with("origin/") {
        let local_name = name.trim_start_matches("origin/");
        let tracked = run_git(&top, &["switch", "--track", name], Duration::from_secs(20))?;
        if tracked.status.success() {
            return Ok(lossy(&tracked.stdout));
        }
        let created = run_git(
            &top,
            &["switch", "-c", local_name, "--track", name],
            Duration::from_secs(20),
        )?;
        return ensure_ok(&created, "检出远程分支");
    }
    let output = run_git(&top, &["switch", "--", name], Duration::from_secs(20))?;
    ensure_ok(&output, "检出分支")
}

pub fn create_branch(repo: &str, name: &str, start_point: Option<&str>) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let name = name.trim();
    if name.is_empty() || name.contains("..") || name.contains(' ') || name.contains('\\') {
        return Err("分支名不合法".into());
    }
    let output = if let Some(start) = start_point {
        run_git(&top, &["switch", "-c", name, "--", start], Duration::from_secs(20))?
    } else {
        run_git(&top, &["switch", "-c", name], Duration::from_secs(20))?
    };
    ensure_ok(&output, "创建分支")
}

pub fn merge_branch(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["merge", "--no-edit", "--", name], Duration::from_secs(40))?;
    ensure_ok(&output, "合并")
}

pub fn rebase_onto(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["rebase", "--", name], Duration::from_secs(40))?;
    ensure_ok(&output, "变基")
}

pub fn pull(repo: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["pull", "--no-edit"], Duration::from_secs(60))?;
    ensure_ok(&output, "拉取")
}

pub fn push(repo: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let upstream = run_git(
        &top,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        Duration::from_secs(8),
    );
    let has_upstream = upstream.map(|o| o.status.success()).unwrap_or(false);
    let output = if has_upstream {
        run_git(&top, &["push"], Duration::from_secs(60))?
    } else {
        let (branch, _) = current_branch(&top)?;
        if branch == "HEAD" {
            return Err("当前是分离头指针，不能推送。".into());
        }
        run_git(&top, &["push", "-u", "origin", &branch], Duration::from_secs(60))?
    };
    ensure_ok(&output, "推送")
}

pub fn stash_save(repo: &str, message: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let msg = if message.trim().is_empty() { "EasyGit stash" } else { message.trim() };
    let output = run_git(&top, &["stash", "push", "-u", "-m", msg], Duration::from_secs(20))?;
    ensure_ok(&output, "贮藏")
}

pub fn stash_apply(repo: &str, index: u32, pop: bool) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let spec = format!("stash@{{{index}}}");
    let verb = if pop { "pop" } else { "apply" };
    let output = run_git(&top, &["stash", verb, &spec], Duration::from_secs(20))?;
    ensure_ok(&output, if pop { "弹出贮藏" } else { "应用贮藏" })
}

pub fn stash_drop(repo: &str, index: u32) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let spec = format!("stash@{{{index}}}");
    let output = run_git(&top, &["stash", "drop", &spec], Duration::from_secs(15))?;
    ensure_ok(&output, "丢弃贮藏")
}

pub fn cherry_pick(repo: &str, hash: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["cherry-pick", "--", hash], Duration::from_secs(30))?;
    ensure_ok(&output, "挑拣提交")
}

pub fn revert_commit(repo: &str, hash: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["revert", "--no-edit", "--", hash], Duration::from_secs(30))?;
    ensure_ok(&output, "还原提交")
}

pub fn reset_mixed(repo: &str, hash: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["reset", "--mixed", "--", hash], Duration::from_secs(20))?;
    ensure_ok(&output, "重置分支")
}

pub fn compare_stat(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["diff", "--stat", &format!("HEAD...{name}")], Duration::from_secs(20))?;
    let text = ensure_ok(&output, "对比分支")?;
    if text.is_empty() {
        Ok("没有差异".into())
    } else {
        Ok(text)
    }
}

fn load_disk_repos() -> Vec<SavedRepoDisk> {
    let Ok(path) = repos_file() else {
        return Vec::new();
    };
    let raw = fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_disk_repos(repos: &[SavedRepoDisk]) -> Result<(), String> {
    let path = repos_file()?;
    let text = serde_json::to_string_pretty(repos).map_err(|err| err.to_string())?;
    fs::write(&path, text).map_err(|err| format!("无法保存仓库列表 {}: {err}", path.display()))
}

pub fn list_saved_repos() -> Vec<SavedRepoDto> {
    load_disk_repos()
        .into_iter()
        .map(|r| {
            let (branch, dirty, ahead, behind) = if validate_repo(&r.path).is_ok() {
                let branch = current_branch(&r.path).map(|b| b.0).unwrap_or_else(|_| "?".into());
                let dirty = status_files(&r.path).map(|f| f.len() as u32).unwrap_or(0);
                let (ahead, behind) = ahead_behind(&r.path);
                (branch, dirty, ahead, behind)
            } else {
                ("missing".into(), 0, 0, 0)
            };
            SavedRepoDto {
                id: r.id,
                name: r.name,
                path: r.path,
                current_branch: branch,
                ahead_count: ahead,
                behind_count: behind,
                dirty_files_count: dirty,
                is_favorite: r.is_favorite,
                last_opened: r.last_opened,
            }
        })
        .collect()
}

pub fn add_saved_repo(name: &str, path: &str) -> Result<SavedRepoDto, String> {
    let top = validate_repo(path)?;
    let mut repos = load_disk_repos();
    let id = repo_id(&top);
    if let Some(existing) = repos.iter_mut().find(|r| r.id == id) {
        existing.last_opened = "刚刚".into();
        if !name.trim().is_empty() {
            existing.name = name.trim().to_string();
        }
        save_disk_repos(&repos)?;
    } else {
        let display = if name.trim().is_empty() {
            filename_of(&top)
        } else {
            name.trim().to_string()
        };
        repos.insert(
            0,
            SavedRepoDisk {
                id: id.clone(),
                name: display,
                path: top.clone(),
                is_favorite: false,
                last_opened: "刚刚".into(),
            },
        );
        save_disk_repos(&repos)?;
    }
    list_saved_repos()
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "保存仓库失败".into())
}

pub fn remove_saved_repo(id: &str) -> Result<Vec<SavedRepoDto>, String> {
    let mut repos = load_disk_repos();
    repos.retain(|r| r.id != id);
    save_disk_repos(&repos)?;
    Ok(list_saved_repos())
}

pub fn toggle_favorite(id: &str) -> Result<Vec<SavedRepoDto>, String> {
    let mut repos = load_disk_repos();
    for repo in &mut repos {
        if repo.id == id {
            repo.is_favorite = !repo.is_favorite;
        }
    }
    save_disk_repos(&repos)?;
    Ok(list_saved_repos())
}

pub fn list_shelves(repo: &str) -> Result<Vec<ShelfItemDto>, String> {
    let dir = shelf_dir(repo)?;
    let mut items = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).unwrap_or_default();
        if let Ok(disk) = serde_json::from_str::<ShelfDisk>(&raw) {
            items.push(ShelfItemDto {
                id: disk.id,
                name: disk.name,
                date: disk.date,
                file_count: disk.files.len() as u32,
                files: disk.files,
            });
        }
    }
    items.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(items)
}

pub fn create_shelf(repo: &str, name: &str, paths: &[String]) -> Result<ShelfItemDto, String> {
    let top = validate_repo(repo)?;
    let rels: Vec<String> = if paths.is_empty() {
        status_files(&top)?.into_iter().map(|f| f.path).collect()
    } else {
        paths.iter().map(|p| safe_rel(p)).collect::<Result<_, _>>()?
    };
    if rels.is_empty() {
        return Err("没有可架藏的变更".into());
    }
    let has_head = run_git(&top, &["rev-parse", "--verify", "HEAD"], Duration::from_secs(8))
        .map(|o| o.status.success())
        .unwrap_or(false);
    let patch = if has_head {
        let mut args = vec!["diff".to_string(), "HEAD".to_string(), "--".to_string()];
        args.extend(rels.iter().cloned());
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let diff = run_git(&top, &arg_refs, Duration::from_secs(20))?;
        lossy(&diff.stdout)
    } else {
        String::new()
    };
    let status = status_files(&top)?;
    let mut files = Vec::new();
    let mut new_files = Vec::new();
    for rel in &rels {
        let Some(file) = status.iter().find(|f| f.path.replace('\\', "/") == rel.replace('\\', "/")) else {
            continue;
        };
        files.push(ShelfFileDto {
            path: file.path.clone(),
            status: file.status.clone(),
            additions: file.additions,
            deletions: file.deletions,
        });
        if file.status == "untracked" {
            let full = Path::new(&top).join(rel);
            if let Ok(bytes) = fs::read(&full) {
                if bytes.len() < 200_000 && !bytes.contains(&0) {
                    new_files.push(NewFileDisk {
                        path: rel.clone(),
                        content: String::from_utf8_lossy(&bytes).into_owned(),
                    });
                }
            }
        }
    }
    if patch.trim().is_empty() && new_files.is_empty() {
        return Err("没有可架藏的文本变更".into());
    }
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "shelf".into());
    let date = chrono_like_now();
    let disk = ShelfDisk {
        id: id.clone(),
        name: if name.trim().is_empty() { format!("Shelf {date}") } else { name.trim().to_string() },
        date: date.clone(),
        files: files.clone(),
        patch,
        new_files,
    };
    let raw = serde_json::to_string_pretty(&disk).map_err(|e| e.to_string())?;
    let shelf_path = shelf_dir(&top)?.join(format!("{id}.json"));
    fs::write(&shelf_path, raw).map_err(|e| format!("写入架藏失败（{}）：{e}", shelf_path.display()))?;
    Ok(ShelfItemDto {
        id,
        name: disk.name,
        date,
        file_count: files.len() as u32,
        files,
    })
}

pub fn unshelve(repo: &str, id: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let path = shelf_dir(&top)?.join(format!("{id}.json"));
    let raw = fs::read_to_string(&path).map_err(|_| "找不到架藏".to_string())?;
    let disk: ShelfDisk = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if !disk.patch.trim().is_empty() {
        let output = run_git_with_stdin(&top, &["apply", "--unidiff-zero"], &disk.patch, Duration::from_secs(20))?;
        ensure_ok(&output, "恢复架藏")?;
    }
    for file in &disk.new_files {
        let rel = safe_rel(&file.path)?;
        let full = Path::new(&top).join(&rel);
        if let Some(parent) = full.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if !full.exists() {
            fs::write(&full, &file.content).map_err(|e| e.to_string())?;
        }
    }
    Ok("已恢复到工作区，架藏仍保留".into())
}

pub fn delete_shelf(repo: &str, id: &str) -> Result<(), String> {
    let top = validate_repo(repo)?;
    let path = shelf_dir(&top)?.join(format!("{id}.json"));
    fs::remove_file(path).map_err(|e| format!("删除架藏失败：{e}"))?;
    Ok(())
}

fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86400) as i64;
    let tod = secs % 86400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("easy-git-test-{}", std::process::id()));
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();
        let init = run_git(&path, &["init", "-b", "main"], Duration::from_secs(10)).unwrap();
        assert!(init.status.success(), "{}", lossy(&init.stderr));
        let _ = run_git(&path, &["config", "user.email", "test@easygit.local"], Duration::from_secs(5));
        let _ = run_git(&path, &["config", "user.name", "EasyGit Test"], Duration::from_secs(5));
        fs::write(dir.join("a.txt"), "hello\n").unwrap();
        dir
    }

    #[test]
    fn status_stage_commit_and_log() {
        let dir = temp_repo();
        let path = dir.to_string_lossy().to_string();
        let files = status_files(&path).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "untracked");

        stage_paths(&path, &["a.txt".into()]).unwrap();
        let staged = status_files(&path).unwrap();
        assert!(staged[0].is_staged, "file should be staged");

        commit(&path, "init", false, false).unwrap();
        let log = git_log(&path).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].subject, "init");
        assert!(log[0].refs.iter().any(|r| r.contains("main")));

        fs::write(dir.join("a.txt"), "hello\nchanged\n").unwrap();
        let diff = file_diff(&path, "a.txt").unwrap();
        assert!(!diff.is_empty(), "expected a diff chunk");
        assert!(diff[0].lines.iter().any(|l| l.kind == "added"));
        apply_chunk(&path, &diff[0].raw_patch, "stage").unwrap();
        let after = status_files(&path).unwrap();
        assert!(after[0].is_staged, "chunk stage should stage the file");

        checkout_branch(&path, &log[0].hash).unwrap();
        let (branch, _) = current_branch(&path).unwrap();
        assert_eq!(branch, "HEAD");
        checkout_branch(&path, "main").unwrap();

        let shelf = create_shelf(&path, "smoke", &["a.txt".into()]).unwrap();
        assert_eq!(shelf.file_count, 1);
        delete_shelf(&path, &shelf.id).unwrap();

        create_branch(&path, "feature-smoke", None).unwrap();
        let (now, _) = current_branch(&path).unwrap();
        let branches = list_branches(&path, &now).unwrap();
        assert!(
            branches.iter().any(|b| b.name == "feature-smoke" && b.is_current),
            "current={now} branches={:?}",
            branches.iter().map(|b| format!("{} current={}", b.name, b.is_current)).collect::<Vec<_>>()
        );
        let before = signature(&path);
        fs::write(dir.join("a.txt"), "stash me\n").unwrap();
        assert_ne!(signature(&path), before, "worktree change should change the watch signature");
        stash_save(&path, "wip").unwrap();
        let stashes = list_stashes(&path).unwrap();
        assert_eq!(stashes.len(), 1);
        stash_apply(&path, stashes[0].index, true).unwrap();
        assert!(list_stashes(&path).unwrap().is_empty());

        fs::write(dir.join("a.txt"), "line1\nkeep\nline3\n").unwrap();
        stage_paths(&path, &["a.txt".into()]).unwrap();
        commit(&path, "two lines", false, false).unwrap();
        fs::write(dir.join("a.txt"), "LINE1\nkeep\nLINE3\n").unwrap();
        let raw = run_git(&path, &["diff", "-U0", "--", "a.txt"], Duration::from_secs(8)).unwrap();
        let chunks = split_hunks(&lossy(&raw.stdout), false, "u");
        assert!(chunks.len() >= 2, "expected two separate hunks, got {}:\n{}", chunks.len(), lossy(&raw.stdout));
        apply_chunk(&path, &chunks[0].raw_patch, "stage").unwrap();
        let cached = run_git(&path, &["diff", "--cached", "-U0", "--", "a.txt"], Duration::from_secs(8)).unwrap();
        let cached_text = lossy(&cached.stdout);
        assert!(cached_text.contains("+LINE1"), "first hunk should be staged");
        assert!(!cached_text.contains("+LINE3"), "second hunk must stay unstaged");
        fs::write(dir.join("a.txt"), "other\nkeep\nLINE3\n").unwrap();
        let refused = apply_chunk(&path, &chunks[0].raw_patch, "rollback");
        assert!(refused.is_err(), "rollback must refuse when the worktree no longer matches");

        fs::write(dir.join("old-name.txt"), "keep\n").unwrap();
        stage_paths(&path, &["old-name.txt".into()]).unwrap();
        commit(&path, "add old name", false, false).unwrap();
        run_git(&path, &["mv", "old-name.txt", "new-name.txt"], Duration::from_secs(8)).unwrap();
        let renamed = status_files(&path).unwrap();
        let renamed_file = renamed.iter().find(|f| f.path.ends_with("new-name.txt")).expect("rename should expose the new path");
        assert_eq!(renamed_file.old_path.as_deref(), Some("old-name.txt"));
        discard_paths(&path, &["new-name.txt".into()]).unwrap();
        assert!(dir.join("old-name.txt").exists(), "rollback must restore the original path");
        assert!(!dir.join("new-name.txt").exists(), "rollback must remove the renamed path");

        fs::write(dir.join("new.txt"), "temp\n").unwrap();
        discard_paths(&path, &["new.txt".into()]).unwrap();
        assert!(!dir.join("new.txt").exists(), "untracked file should leave the worktree");

        let _ = fs::remove_dir_all(&dir);
    }
}

pub fn pick_directory() -> Result<Option<String>, String> {
    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '选择 Git 仓库目录'
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
"#;
    let output = Command::new("powershell")
        .args(["-STA", "-NoProfile", "-Command", script])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("无法打开目录选择器：{e}"))?;
    let path = lossy(&output.stdout);
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path.lines().next().unwrap_or("").trim().to_string()))
    }
}
