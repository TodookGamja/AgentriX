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
- **⌨️ 채팅창 전송 개선**: 여러 줄·파일 경로가 포함된 메시지도 Enter 한 번으로 바로 전송 (붙여넣기 처리 후 Enter 분리 전송)
- **🤖 Codex 에이전트 실행 오류 수정**: Codex 0.164에서 제거된 \`--full-auto\` 대신 \`--sandbox workspace-write --ask-for-approval never\` 사용
- **🧠 모델 선택 기능**: 에이전트별·CLI별 실행 모델 지정 (각 CLI의 실제 모델 목록 자동 표시)
- **📊 잔여 한도 실시간 조회**: Codex·Grok·Antigravity 공식 API 연동, 가짜 기본값 표시 제거, 새로고침 시 실제 재조회
- **🖥️ 터미널 안정화**: 화면 전환 시 줄 중복/늘어남 수정, 작업 중 위로 스크롤 유지
- **🗜️ 불필요한 자동 /compact 방지**: 화면 재표시·스피너 출력을 토큰 추정에서 제외
- **🔀 자동 인수인계 시 화면 강제 이동 제거**
- **📁 재실행 후에도 등록 에이전트가 사이드바 프로젝트 트리에 표시** (클릭 시 바로 실행)
- **🏷️ 좌하단 버전 표시 자동화** (package.json 버전과 항상 일치)

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
