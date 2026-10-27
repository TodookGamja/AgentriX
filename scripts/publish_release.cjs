const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
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

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'AgentriX-Uploader',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    const owner = 'TodookGamja';
    const repo = 'AgentriX';
    const tag = 'v1.0.0';

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
        console.log('Creating new release...');
        const createBody = {
            tag_name: tag,
            target_commitish: 'main',
            name: 'AgentriX v1.0.0 - 공식 출시 (Official Release)',
            body: `## 🚀 AgentriX v1.0.0 공식 출시!

AI CLI를 가장 편리하고 스마트하게 관리하는 데스크톱 매니저 **AgentriX**의 첫 공식 릴리즈입니다.

### ✨ 주요 변경 및 추가 기능
- **터미널 클립보드 & 드래그 앤 드롭 지원**:
  - \`Win + Shift + S\` 캡처 후 터미널에 \`Ctrl + V\` 즉시 이미지 자동 저장 및 경로 입력
  - 파일 탐색기에서 파일/이미지를 터미널로 직관적으로 드래그 앤 드롭
- **AGY CLI 세션 완벽 관리**:
  - \`Conversation already open\` 좀비 프로세스 방지 (Windows 프로세스 트리 강제 정리)
  - 실시간 토큰 사용량 & 리셋 카운트다운 타이머 UI 개선
- **강력한 원클릭 앱 업데이트**:
  - 헤더, 사이드바, 설정 화면에서 언제든지 최신 버전 확인 및 다운로드 가능
- **다크 / 라이트 모드 가독성 최적화**

### 📦 다운로드 안내
- **단일 실행 파일 (무설치 포터블)**: \`AgentriX.exe\` (다운로드 후 바로 실행)
- **포터블 압축 패키지**: \`AgentriX-Portable-v1.0.0-win-x64.zip\`
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
    const filesToUpload = [
        { localPath: path.resolve('release/AgentriX.exe'), name: 'AgentriX.exe', mime: 'application/octet-stream' },
        { localPath: path.resolve('release/AgentriX-Portable-v1.0.0-win-x64.zip'), name: 'AgentriX-Portable-v1.0.0-win-x64.zip', mime: 'application/zip' }
    ];

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
