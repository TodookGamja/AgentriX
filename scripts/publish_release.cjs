const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const owner = 'TodookGamja';
const repo = 'AgentriX';

// release-notes/<tag>.md에는 "## 한국어" / "## English" 아래 항목(- **🔧 제목**: 설명)만 적고, 양식은 여기서 고정 생성
function renderNotes(tag, prevTag) {
    const src = fs.readFileSync(path.join('release-notes', `${tag}.md`), 'utf8');
    const section = (name) => {
        const m = src.match(new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`));
        const items = (m ? m[1] : '').split(/\r?\n/).filter((l) => l.startsWith('- '));
        if (!items.length) throw new Error(`release-notes/${tag}.md: "## ${name}" 섹션에 "- " 항목이 없습니다.`);
        return items.join('\n');
    };
    const ko = section('한국어');
    const en = section('English');
    return `## 🚀 AgentriX ${tag} 업데이트 안내

### ✨ 이번 버전(${tag}) 주요 수정 및 개선 사항
${ko}

### 📦 다운로드 안내
- **단일 무설치 실행 파일**: \`AgentriX.exe\` (다운로드 후 바로 실행)
- **윈도우 정식 설치 인스톨러**: \`AgentriX-Setup-${tag}.exe\`

---

## 🚀 AgentriX ${tag} Release Notes

### ✨ What's New in ${tag}
${en}

### 📦 Downloads
- **Single portable executable**: \`AgentriX.exe\` (run directly after download)
- **Windows installer**: \`AgentriX-Setup-${tag}.exe\`
${prevTag ? `
**Full Changelog**: https://github.com/${owner}/${repo}/compare/${prevTag}...${tag}
` : ''}`;
}

const releaseName = (tag) => `AgentriX ${tag} - 업데이트 릴리즈 (Official Release)`;

// 미리보기: node scripts/publish_release.cjs --notes v1.1.0 v1.0.10
if (process.argv[2] === '--notes') {
    process.stdout.write(renderNotes(process.argv[3], process.argv[4]));
    process.exit(0);
}

async function main() {
  execSync('cargo test --manifest-path src-tauri/Cargo.toml --release verify_release_artifact -- --ignored', { stdio: 'inherit' });
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const version = pkg.version;
    const tag = `v${version}`;
    const setupName = `AgentriX-Setup-${tag}.exe`;
    const filesToUpload = [
        { localPath: path.resolve('release/AgentriX.exe'), name: 'AgentriX.exe', mime: 'application/octet-stream' },
        { localPath: path.resolve('release/AgentriX.exe.sig'), name: 'AgentriX.exe.sig', mime: 'application/octet-stream' },
        { localPath: path.resolve(`release/${setupName}`), name: setupName, mime: 'application/octet-stream' }
    ];
    for (const file of filesToUpload) fs.accessSync(file.localPath, fs.constants.R_OK);
    const prevTag = (await (await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`)).json())
        .map((r) => r.tag_name).find((t) => t !== tag);
    const notes = renderNotes(tag, prevTag);

    console.log(`Starting automated release for ${tag}...`);

    console.log('1. Getting GitHub token from git credential helper...');
    let token = '';
    try {
        const credOutput = execSync('git credential fill', {
            input: 'protocol=https\nhost=github.com\n',
            encoding: 'utf-8'
        });
        const match = credOutput.match(/password=(.+)/);
        if (match) {
            token = match[1].trim();
        }
    } catch (e) {
        console.error('Failed to get git credential:', e.message);
    }

    if (!token) {
        console.error('No token found!');
        process.exit(1);
    }

    console.log('Token retrieved successfully.');

    // Create & push git tag if not already pushed
    console.log(`Pushing git tag ${tag}...`);
    try {
        execSync(`git tag -a ${tag} -m "Release ${tag}"`, { stdio: 'ignore' });
    } catch (e) {}
    try {
        execSync(`git push origin ${tag}`, { stdio: 'inherit' });
    } catch (e) {
        console.warn('Tag push note:', e.message);
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'AgentriX-Uploader',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    console.log(`2. Checking release for tag ${tag}...`);
    let release = null;
    try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { credentials: 'omit', headers });
        if (res.ok) {
            release = await res.json();
            console.log(`Found existing release: ${release.id}`);
        } else if (res.status !== 404) {
            const errText = await res.text();
            console.warn(`Unexpected status ${res.status}: ${errText}`);
        }
    } catch (e) {
        console.error('Error fetching release:', e.message);
    }

    if (!release) {
        console.log(`Creating new release ${tag}...`);
        const createBody = {
            tag_name: tag,
            target_commitish: 'main',
            name: releaseName(tag),
            body: notes,
            draft: false,
            prerelease: false
        };

        const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(createBody)
        });

        if (!createRes.ok) {
            const errText = await createRes.text();
            throw new Error(`Failed to create release (${createRes.status}): ${errText}`);
        }
        release = await createRes.json();
        console.log(`Created release ID: ${release.id}`);
    }

    // 3. Delete any existing assets with duplicate names
    console.log('3. Checking existing assets...');
    const assetsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}/assets`, { headers });
    if (assetsRes.ok) {
        const assets = await assetsRes.json();
        for (const asset of assets) {
            console.log(`Deleting existing asset: ${asset.name} (id: ${asset.id})`);
            await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`, {
                method: 'DELETE',
                headers
            });
        }
    }

    // 4. Upload files

    for (const f of filesToUpload) {
        console.log(`Uploading ${f.name} (${(fs.statSync(f.localPath).size / 1024 / 1024).toFixed(2)} MB)...`);
        const fileData = fs.readFileSync(f.localPath);
        const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(f.name)}`;

        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': f.mime,
                'Content-Length': fileData.length.toString(),
                'User-Agent': 'AgentriX-Uploader'
            },
            body: fileData
        });

        if (!uploadRes.ok) {
            const err = await uploadRes.text();
            throw new Error(`Upload failed for ${f.name} (${uploadRes.status}): ${err}`);
        }
        const assetInfo = await uploadRes.json();
        console.log(`Successfully uploaded: ${assetInfo.name} -> ${assetInfo.browser_download_url}`);
    }

    console.log('\n=== ALL RELEASE ARTIFACTS PUBLISHED SUCCESSFULLY! ===');
    console.log(`Release URL: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
