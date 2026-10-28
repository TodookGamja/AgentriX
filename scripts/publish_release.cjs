const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const version = pkg.version;
    const tag = `v${version}`;
    const owner = 'TodookGamja';
    const repo = 'AgentriX';

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
            name: `AgentriX ${tag} - 업데이트 릴리즈 (Official Release)`,
            body: `## 🚀 AgentriX ${tag} 업데이트 안내

### ✨ 이번 버전(${tag}) 주요 수정 및 개선 사항
- **📋 블랙보드 자동 배정**: 작업표 상태를 \`🔥 착수\`로 바꾸면 담당 에이전트 터미널에 자동 전달, \`✅ 완료\` 시 PM에게 자동 보고 → 에이전트 간 무인 연쇄 진행
- **🪟 창 최대화/복원 토글이 원상복구되던 문제 수정**: 타이틀바 더블클릭 시 토글이 두 번 실행되던 버그
- **🛡️ 세션 인수인계 파일 보안 강화**: 파일명 경로 탐색 차단, 저장 시 API 키·토큰 자동 마스킹
- **🧹 에이전트 삭제 시 디스크의 역할 폴더도 함께 정리**
- **🔤 터미널 출력 중 잘못된 바이트 뒤 한글이 깨지던 문제 수정**

### 📦 다운로드 안내
- **단일 무설치 실행 파일**: \`AgentriX.exe\` (다운로드 후 바로 실행)
- **포터블 압축 패키지**: \`AgentriX-Portable-${tag}-win-x64.zip\`
- **윈도우 정식 설치 인스톨러**: \`AgentriX-Setup-${tag}.exe\`
`,
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
    const zipName = `AgentriX-Portable-${tag}-win-x64.zip`;
    const setupName = `AgentriX-Setup-${tag}.exe`;
    const filesToUpload = [
        { localPath: path.resolve('release/AgentriX.exe'), name: 'AgentriX.exe', mime: 'application/octet-stream' },
        { localPath: path.resolve(`release/${zipName}`), name: zipName, mime: 'application/zip' }
    ];
    const setupPath = path.resolve(`release/AgentriX-Setup-${tag}.exe`);
    if (fs.existsSync(setupPath)) {
        filesToUpload.push({
            localPath: setupPath,
            name: setupName,
            mime: 'application/octet-stream'
        });
    }

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
