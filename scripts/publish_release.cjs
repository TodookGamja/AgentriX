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
- **UI 정렬 셀렉터 이중 박스 완전 제거**:
  - 부모 테두리와 내부 select의 중복 테두리를 제거하고 매끄러운 단일 필 UI로 개편
- **동적 CLI 대상 필터 & 쿼터 카드 확장**:
  - 고정된 4~5개 제한을 풀고 **Cursor Agent CLI, OpenCode CLI 및 모든 커스텀 추가 CLI**까지 실시간 감지하여 탭 및 그리드 카드에 자동 추가
- **라이트 모드 토스트 가독성 최적화**:
  - 라이트 모드에서 검은 배경에 검은 글씨로 나오던 문제를 순수 화이트 고대비 컬러로 수정
- **리셋 잔여 시간 과거 시간 표시 버그 수정**:
  - 만료된 캐시 자동 파기 및 현재 시각 기준 이미 지난 시간("18:59" 등)은 "리셋 완료"로 정상 검증 처리
- **좌하단 사용자 프로필 및 업데이트 버튼 UI 재배치**:
  - 상단 헤더 겹침을 완전 해결하고 사이드바 좌하단에 깔끔하게 배치

### 📦 다운로드 안내
- **단일 무설치 실행 파일**: \`AgentriX.exe\` (다운로드 후 바로 실행)
- **포터블 압축 패키지**: \`AgentriX-Portable-${tag}-win-x64.zip\`
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
    if (fs.existsSync(path.resolve('release/AgentriX-Setup-v1.0.2.exe'))) {
        filesToUpload.push({
            localPath: path.resolve('release/AgentriX-Setup-v1.0.2.exe'),
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
