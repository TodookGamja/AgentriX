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
- **🖥️ 터미널 스크롤 멈춤/화면 깨짐 수정**: xterm 6.0 업그레이드(동기화 출력 지원) + Windows ConPTY 모드 적용
- **📎 파일 첨부 개선**: 경로를 콘솔에 바로 입력하지 않고 채팅창 위 첨부 칩으로 표시 (Ctrl+V · 드래그 앤 드롭 · 첨부 버튼), 전송 시 함께 전달
- **↕️ 채팅창 높이 조절**: 터미널과 채팅창 사이 핸들을 드래그해 크기 조절 (설정 유지)
- **🧹 터미널 헤더 간소화**: 프로젝트·역할과 핵심 기능(토큰 최적화·릴레이·중단)만 표시
- **🧠 모델 선택 위치 개선**: 일반 CLI 실행 카드에서 바로 모델 지정
- **📊 사용량/쿼터 자동 새로고침** (60초 주기)
- **🎨 업데이트 안내 창 버튼 정렬 수정**

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
