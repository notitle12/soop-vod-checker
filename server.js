const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const COMMON_BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getRandomJitter = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ======================================================
// 1. SOOP 다시보기 데이터 수집 API
// ======================================================
app.get('/api/vods', async (req, res) => {
    const { bjId, maxCount = 50, startDate = '2026-06-01', skipOld = 'false' } = req.query;

    if (!bjId || !/^[a-zA-Z0-9_]{3,30}$/.test(bjId)) {
        return res.status(400).json({ error: '올바른 형식의 스트리머 ID(영문, 숫자 3~30자)를 입력해주세요.' });
    }

    const targetMax = parseInt(maxCount, 10);
    const isSkipOld = skipOld === 'true';
    const results = [];
    let page = 1;
    let totalPages = 1;
    const perPage = 60;

    try {
        while (page <= totalPages) {
            const apiUrl = `https://api-channel.sooplive.com/v1.1/channel/${encodeURIComponent(bjId)}/vod/review?startDate=${encodeURIComponent(startDate || '')}&endDate=&keyword=&orderBy=reg_date&perPage=${perPage}&page=${page}&field=title,contents,user_nick,user_id`;

            let response;
            let retryCount = 0;

            while (retryCount < 3) {
                try {
                    response = await axios.get(apiUrl, {
                        headers: {
                            ...COMMON_BROWSER_HEADERS,
                            'Referer': `https://www.sooplive.com/station/${encodeURIComponent(bjId)}/vod/review`
                        },
                        timeout: 10000
                    });
                    break;
                } catch (err) {
                    if (err.response && (err.response.status === 429 || err.response.status === 503)) {
                        retryCount++;
                        const backoffDelay = (2 ** retryCount) * 1000 + getRandomJitter(500, 1500);
                        console.warn(`[429/503 감지] ${backoffDelay}ms 후 재시도 (${retryCount}/3)`);
                        await sleep(backoffDelay);
                    } else {
                        throw err;
                    }
                }
            }

            if (!response) {
                throw new Error('API 요청 제한 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.');
            }

            const resData = response.data?.data || response.data;
            const meta = resData.meta || {};
            const items = resData.contents || [];

            if (page === 1 && meta.totalPages) {
                totalPages = meta.totalPages;
            }

            if (items.length === 0) break;

            for (const item of items) {
                if (isSkipOld && item.regDate && item.regDate < '2026-06-01') {
                    continue;
                }

                if (startDate && item.regDate && item.regDate < startDate) {
                    continue;
                }

                const vodReadCnt = item.count?.vodReadCnt ?? 0;
                if (vodReadCnt < targetMax) {
                    const isAdult = (item.grade === 19 || item.ucc?.grade === 19);
                    const isPaid = (item.paidPpv === true || item.ucc?.paidPpv === true);

                    results.push({
                        titleNo: String(item.titleNo),
                        title: item.titleName || '(제목 없음)',
                        vodReadCnt: vodReadCnt,
                        generalReadCnt: item.count?.readCnt ?? 0,
                        userNick: item.userNick || '',
                        userId: item.userId || '',
                        regDate: item.regDate,
                        thumb: item.ucc?.thumb || '',
                        isAdult: isAdult,
                        isPaid: isPaid,
                        url: `https://vod.sooplive.com/player/${item.titleNo}`
                    });
                }
            }

            const oldestOnPage = items[items.length - 1]?.regDate;
            if (startDate && oldestOnPage && oldestOnPage < startDate) {
                break;
            }

            page++;
            await sleep(getRandomJitter(400, 800));
        }

        results.sort((a, b) => a.vodReadCnt - b.vodReadCnt);

        res.json({
            bjId,
            threshold: targetMax,
            startDate: startDate || '전체 기간',
            totalPagesChecked: page > totalPages ? totalPages : page,
            totalFound: results.length,
            items: results
        });
    } catch (error) {
        console.error('수집 에러:', error.message);
        res.status(500).json({ error: '데이터를 가져오는 중 오류가 발생했습니다: ' + error.message });
    }
});

// ======================================================
// 2. 화면 서빙
// ======================================================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>SOOP 삭제예정 다시보기 탐색기</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; color: #1e293b; background-color: #f8fafc; }
        
        h2 { margin-top: 0; color: #0f172a; display: flex; align-items: center; gap: 8px; font-size: 1.5rem; }
        
        .control-panel { background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 20px; display: flex; flex-direction: column; gap: 14px; }
        .control-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        
        .input-group { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        label { font-size: 13px; font-weight: 600; color: #475569; white-space: nowrap; }
        input[type="text"], input[type="date"], input[type="number"], select { padding: 9px 14px; font-size: 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; }
        input:focus, select:focus { outline: none; border-color: #0070f3; }
        
        input:disabled, select:disabled { background-color: #f1f5f9; color: #94a3b8; border-color: #e2e8f0; cursor: not-allowed; }
        
        #bjId { flex: 1; min-width: 200px; }

        .btn { padding: 9px 14px; font-size: 14px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; transition: all 0.2s; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
        .btn-primary { background-color: #0070f3; color: white; flex: 1; min-width: 140px; }
        .btn-primary:hover { background-color: #0051bb; }
        .btn-primary:disabled { background-color: #94a3b8; cursor: not-allowed; }

        .btn-mode { background-color: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
        .btn-mode:hover { background-color: #e2e8f0; }
        .btn-mode.active { background-color: #0f172a; color: white; border-color: #0f172a; }

        .btn-external { background-color: #8b5cf6; color: white; font-size: 13px; padding: 9px 12px; }
        .btn-external:hover { background-color: #7c3aed; }

        .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #334155; cursor: pointer; user-select: none; }
        .checkbox-label input { width: 16px; height: 16px; cursor: pointer; }

        .toolbar { display: none; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
        .status { font-size: 14px; font-weight: 600; color: #334155; }
        .sort-buttons { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        
        .sort-toggle-btn {
            background-color: #fff; color: #475569; border: 1px solid #cbd5e1; padding: 6px 14px; font-size: 13px; font-weight: 600; border-radius: 20px; cursor: pointer;
        }
        .sort-toggle-btn.active { background-color: #0070f3; color: #fff; border-color: #0070f3; }

        .table-wrap { background: #fff; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow-x: auto; -webkit-overflow-scrolling: touch; }
        table { width: 100%; border-collapse: collapse; text-align: left; min-width: 750px; }
        th, td { padding: 12px 16px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
        th { background-color: #f1f5f9; font-size: 13px; color: #475569; font-weight: 600; user-select: none; white-space: nowrap; }
        th.sortable { cursor: pointer; }
        th.sortable:hover { background-color: #e2e8f0; }
        tr:hover { background-color: #f8fafc; }
        
        .badge { background: #fee2e2; color: #dc2626; padding: 4px 9px; border-radius: 12px; font-weight: 700; font-size: 12px; white-space: nowrap; }
        .delete-badge { background: #fef3c7; color: #d97706; padding: 4px 9px; border-radius: 12px; font-weight: 700; font-size: 12px; white-space: nowrap; display: inline-block; margin-top: 3px; }
        .tag-badge { padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 800; margin-left: 6px; color: white; display: inline-block; vertical-align: middle; }
        .tag-19 { background: #ef4444; }
        .tag-paid { background: #f59e0b; }
        
        .thumb-link { display: inline-block; border-radius: 6px; overflow: hidden; line-height: 0; }
        .thumb-img { width: 96px; height: 54px; object-fit: cover; border-radius: 6px; display: block; transition: transform 0.15s ease, opacity 0.15s ease; }
        .thumb-link:hover .thumb-img { opacity: 0.85; transform: scale(1.03); }
        
        .btn-link { display: inline-block; background-color: #0070f3; color: #fff; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 12px; font-weight: 600; white-space: nowrap; }
        .btn-link:hover { background-color: #0051bb; }
        .title-link { color: #0f172a; text-decoration: none; font-weight: 500; display: inline-block; max-width: 300px; white-space: normal; word-break: break-all; }
        .title-link:hover { color: #0070f3; text-decoration: underline; }

        @media (max-width: 900px) {
            .control-row { flex-direction: column; align-items: stretch; }
            .input-group { width: 100%; justify-content: space-between; }
            .input-group input, .input-group select { flex: 1; margin-left: 10px; }
            #bjId { width: 100%; flex: none; }
            .btn { width: 100%; }
        }
    </style>
</head>
<body>
    <h2>SOOP 삭제예정 다시보기 탐색기</h2>
    
    <div class="control-panel">
        <div class="control-row">
            <input type="text" id="bjId" placeholder="스트리머 ID 입력">
            
            <div class="input-group">
                <label for="startDate">시작일:</label>
                <input type="date" id="startDate">
            </div>

            <div class="input-group" id="besDateGroup">
                <label for="besYear" id="besLabel">베스 승급일:</label>
                <select id="besYear" onchange="onBesDateChange()" disabled>
                    <option value="2024">2024년</option>
                    <option value="2025">2025년</option>
                    <option value="2026" selected>2026년</option>
                    <option value="2027">2027년</option>
                </select>
                <select id="besMonth" onchange="onBesDateChange()" disabled>
                    <option value="1">1월</option><option value="2">2월</option><option value="3">3월</option>
                    <option value="4">4월</option><option value="5">5월</option><option value="6">6월</option>
                    <option value="7">7월</option><option value="8">8월</option><option value="9" selected>9월</option>
                    <option value="10">10월</option><option value="11">11월</option><option value="12">12월</option>
                </select>
                <a href="https://afevent2.sooplive.com/app/star_bj/bestbj/best_bj_list.php" target="_blank" rel="noopener noreferrer" class="btn btn-external">베스조회 ↗</a>
            </div>

            <div class="input-group" style="display:none;">
                <label for="maxCount">최대 조회수:</label>
                <input type="number" id="maxCount" value="50">
            </div>

            <button id="searchBtn" class="btn btn-primary" onclick="fetchVods()">다시보기 탐색 실행</button>
        </div>

        <div class="control-row" style="justify-content: space-between; border-top: 1px solid #f1f5f9; padding-top: 12px;">
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button id="modeIlsBtn" class="btn btn-mode active" onclick="setMode('ilsNormal')">일스(50미만)</button>
                <button id="modeIlsAllBtn" class="btn btn-mode" onclick="setMode('ilsAll')">일스: 전체조회(1년)</button>
                <button id="modeBesBtn" class="btn btn-mode" onclick="setMode('bes')">베스: 1001 미만 (2년)</button>
            </div>

            <label class="checkbox-label">
                <input type="checkbox" id="skipOldCheck" checked onchange="updateStartDateByMode()">
                다시보기작(6/1 이전) 영구보관 제외
            </label>
        </div>
    </div>

    <div class="toolbar" id="toolbar">
        <div class="status" id="statusText"></div>
        <div class="sort-buttons">
            <span style="font-size: 13px; font-weight: 600; color: #64748b; margin-right: 4px;">정렬:</span>
            <button class="sort-toggle-btn active" id="btn-sort-read" onclick="handleSortClick('vodReadCnt')">
                조회수 <span id="read-arrow">▲</span>
            </button>
            <button class="sort-toggle-btn" id="btn-sort-date" onclick="handleSortClick('regDate')">
                등록일 <span id="date-arrow">▲</span>
            </button>
            <button class="btn btn-mode" onclick="downloadExcel()" style="margin-left: auto; padding: 6px 14px; border-radius: 20px; font-size: 13px;">엑셀 다운로드</button>
        </div>
    </div>

    <div class="table-wrap" id="tableWrap" style="display: none;">
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">번호</th>
                    <th style="width: 110px;">썸네일</th>
                    <th style="width: 110px;" class="sortable" onclick="handleSortClick('vodReadCnt')">
                        재생수 <span id="th-read-icon">▲</span>
                    </th>
                    <th>제목</th>
                    <th style="width: 120px;">스트리머</th>
                    <th style="width: 170px;" class="sortable" onclick="handleSortClick('regDate')">
                        등록일 / 삭제예정일 <span id="th-date-icon"></span>
                    </th>
                    <th style="width: 90px; text-align: center;">다시보기</th>
                </tr>
            </thead>
            <tbody id="tableBody"></tbody>
        </table>
    </div>

    <script>
        let currentVods = [];
        let activeField = 'vodReadCnt';
        let sortDirections = { vodReadCnt: 'asc', regDate: 'asc' };
        let currentMode = 'ilsNormal';

        window.addEventListener('DOMContentLoaded', () => {
            const savedBjId = localStorage.getItem('saved_soop_bj_id');
            if (savedBjId) {
                document.getElementById('bjId').value = savedBjId;
            }
            calculateLastWorkday();
            setMode('ilsNormal');
        });

        document.getElementById('bjId').addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val) localStorage.setItem('saved_soop_bj_id', val);
        });

        function calculateLastWorkday() {
            const year = parseInt(document.getElementById('besYear').value, 10);
            const month = parseInt(document.getElementById('besMonth').value, 10);

            let date = new Date(year, month, 0);

            while (date.getDay() === 0 || date.getDay() === 6) {
                date.setDate(date.getDate() - 1);
            }

            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            
            window.calculatedBesPromoteDate = \`\${yyyy}-\${mm}-\${dd}\`;
        }

        function onBesDateChange() {
            calculateLastWorkday();
            updateStartDateByMode();
            if (currentVods.length > 0) {
                renderSortedData(); // 베스 승급일 변경 시 즉시 재계산 반영
            }
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function formatHourOnly(dateStr) {
            if (!dateStr) return '-';
            if (dateStr.length >= 13) {
                return dateStr.slice(0, 10) + ' ' + dateStr.slice(11, 13) + '시';
            }
            return dateStr;
        }

        function calculateDeletionInfo(regDateStr, vodReadCnt) {
            if (!regDateStr) return { deleteDateStr: '-', ddayText: '-' };

            const regDate = new Date(regDateStr.replace(/-/g, '/'));
            if (isNaN(regDate.getTime())) return { deleteDateStr: regDateStr, ddayText: '-' };

            let daysToAdd = 90;

            if (currentMode === 'bes') {
                const promoteDateStr = window.calculatedBesPromoteDate;
                const promoteDate = promoteDateStr ? new Date(promoteDateStr.replace(/-/g, '/')) : null;

                if (promoteDate) {
                    const survivalLimitDate = new Date(promoteDate.getTime() - (90 * 24 * 60 * 60 * 1000));

                    if (regDate < survivalLimitDate) {
                        daysToAdd = 90; // 승급 전 이미 삭제되었을 영상
                    } else {
                        daysToAdd = 730; // 승급 당시 살아남아 2년 혜택 적용
                    }
                } else {
                    daysToAdd = 730;
                }
            } else if (currentMode === 'ilsAll') {
                daysToAdd = (vodReadCnt < 50) ? 90 : 365;
            } else {
                daysToAdd = 90;
            }

            const deleteDate = new Date(regDate.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));

            const yyyy = deleteDate.getFullYear();
            const mm = String(deleteDate.getMonth() + 1).padStart(2, '0');
            const dd = String(deleteDate.getDate()).padStart(2, '0');
            const hh = String(deleteDate.getHours()).padStart(2, '0');
            const deleteDateStr = \`\${yyyy}-\${mm}-\${dd} \${hh}시\`;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const targetDateOnly = new Date(deleteDate);
            targetDateOnly.setHours(0, 0, 0, 0);

            const diffDays = Math.ceil((targetDateOnly - today) / (1000 * 60 * 60 * 24));
            
            let ddayText = '';
            if (diffDays > 0) {
                ddayText = \`D-\${diffDays}\`;
            } else if (diffDays === 0) {
                ddayText = '오늘 날짜 기준 삭제예정';
            } else {
                ddayText = '기한 경과';
            }

            return { deleteDateStr, ddayText };
        }

        function setMode(mode) {
            currentMode = mode;
            const maxCountInput = document.getElementById('maxCount');
            const besYear = document.getElementById('besYear');
            const besMonth = document.getElementById('besMonth');
            const besLabel = document.getElementById('besLabel');
            
            document.getElementById('modeIlsBtn').classList.remove('active');
            document.getElementById('modeIlsAllBtn').classList.remove('active');
            document.getElementById('modeBesBtn').classList.remove('active');

            if (mode === 'ilsNormal') {
                maxCountInput.value = 50;
                document.getElementById('modeIlsBtn').classList.add('active');
                besYear.disabled = true;
                besMonth.disabled = true;
                besLabel.style.color = '#94a3b8';
            } else if (mode === 'ilsAll') {
                maxCountInput.value = 5000;
                document.getElementById('modeIlsAllBtn').classList.add('active');
                besYear.disabled = true;
                besMonth.disabled = true;
                besLabel.style.color = '#94a3b8';
            } else if (mode === 'bes') {
                maxCountInput.value = 1001;
                document.getElementById('modeBesBtn').classList.add('active');
                besYear.disabled = false;
                besMonth.disabled = false;
                besLabel.style.color = '#0f172a';
                calculateLastWorkday();
            }

            updateStartDateByMode();

            // 모드 변경 즉시 화면(테이블)의 날짜 계산 결과 재반영
            if (currentVods.length > 0) {
                renderSortedData();
            }
        }

        function updateStartDateByMode() {
            const startDateInput = document.getElementById('startDate');
            const isSkipOld = document.getElementById('skipOldCheck').checked;
            const today = new Date();
            let targetDate = new Date();

            if (currentMode === 'ilsNormal') {
                targetDate.setDate(today.getDate() - 90);
            } else if (currentMode === 'ilsAll') {
                targetDate.setFullYear(today.getFullYear() - 1);
            } else if (currentMode === 'bes') {
                const promoteDateStr = window.calculatedBesPromoteDate;
                if (promoteDateStr) {
                    const promoteDate = new Date(promoteDateStr.replace(/-/g, '/'));
                    targetDate = new Date(promoteDate.getTime() - (90 * 24 * 60 * 60 * 1000));
                } else {
                    targetDate.setFullYear(today.getFullYear() - 2);
                }
            }

            const yyyy = targetDate.getFullYear();
            const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
            const dd = String(targetDate.getDate()).padStart(2, '0');
            let calculatedDateStr = \`\${yyyy}-\${mm}-\${dd}\`;

            if (isSkipOld && calculatedDateStr < '2026-06-01') {
                calculatedDateStr = '2026-06-01';
            }

            startDateInput.value = calculatedDateStr;
        }

        function downloadExcel() {
            if (currentVods.length === 0) {
                alert('다운로드할 데이터가 없습니다.');
                return;
            }

            let csvContent = '\\uFEFF등록일,삭제예정일,제목,현재조회수,링크\\n';
            
            currentVods.forEach(item => {
                const regDate = formatHourOnly(item.regDate);
                const { deleteDateStr } = calculateDeletionInfo(item.regDate, item.vodReadCnt);
                const title = \`"\${item.title.replace(/"/g, '""')}"\`;
                const views = item.vodReadCnt;
                const link = \`https://vod.sooplive.com/player/\${item.titleNo}\`;
                
                csvContent += \`\${regDate},\${deleteDateStr},\${title},\${views},\${link}\\n\`;
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            
            link.setAttribute('href', url);
            link.setAttribute('download', \`VOD_삭제예정목록_\${new Date().getTime()}.csv\`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        async function fetchVods() {
            const bjId = document.getElementById('bjId').value.trim();
            const maxCount = document.getElementById('maxCount').value;
            const startDate = document.getElementById('startDate').value;
            const skipOld = document.getElementById('skipOldCheck').checked;
            
            const btn = document.getElementById('searchBtn');
            const status = document.getElementById('statusText');
            const toolbar = document.getElementById('toolbar');
            const tableWrap = document.getElementById('tableWrap');
            const tbody = document.getElementById('tableBody');

            if (!bjId) {
                alert('스트리머 ID를 입력하세요.');
                return;
            }

            localStorage.setItem('saved_soop_bj_id', bjId);

            btn.disabled = true;
            status.innerText = '조건에 맞는 다시보기 목록 수집 중...';
            tbody.innerHTML = '';
            tableWrap.style.display = 'none';
            toolbar.style.display = 'flex';

            try {
                const query = new URLSearchParams({ bjId, maxCount, startDate, skipOld });
                const res = await fetch(\`/api/vods?\${query.toString()}\`);
                const data = await res.json();

                if (res.status !== 200) {
                    throw new Error(data.error || '조회 실패');
                }

                currentVods = data.items || [];
                status.innerText = \`총 \${data.totalFound}개의 다시보기를 찾았습니다.\`;

                if (currentVods.length > 0) {
                    tableWrap.style.display = 'block';
                    activeField = 'vodReadCnt';
                    sortDirections.vodReadCnt = 'asc';
                    sortDirections.regDate = 'asc';
                    renderSortedData();
                } else {
                    status.innerText += ' (조건에 해당하는 영상이 없습니다)';
                }
            } catch (err) {
                status.innerText = '오류: ' + err.message;
            } finally {
                btn.disabled = false;
            }
        }

        function handleSortClick(field) {
            if (activeField === field) {
                sortDirections[field] = (sortDirections[field] === 'asc') ? 'desc' : 'asc';
            } else {
                activeField = field;
                sortDirections[field] = 'asc';
            }
            renderSortedData();
        }

        function renderSortedData() {
            const order = sortDirections[activeField];

            if (activeField === 'vodReadCnt') {
                currentVods.sort((a, b) => order === 'asc' ? a.vodReadCnt - b.vodReadCnt : b.vodReadCnt - a.vodReadCnt);
            } else if (activeField === 'regDate') {
                currentVods.sort((a, b) => {
                    const valA = a.regDate || '';
                    const valB = b.regDate || '';
                    return order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                });
            }

            document.getElementById('btn-sort-read').classList.toggle('active', activeField === 'vodReadCnt');
            document.getElementById('btn-sort-date').classList.toggle('active', activeField === 'regDate');
            document.getElementById('read-arrow').innerText = sortDirections.vodReadCnt === 'asc' ? '▲' : '▼';
            document.getElementById('date-arrow').innerText = sortDirections.regDate === 'asc' ? '▲' : '▼';

            document.getElementById('th-read-icon').innerText = (activeField === 'vodReadCnt') ? (order === 'asc' ? ' ▲' : ' ▼') : '';
            document.getElementById('th-date-icon').innerText = (activeField === 'regDate') ? (order === 'asc' ? ' ▲' : ' ▼') : '';

            renderList();
        }

        function renderList() {
            const tbody = document.getElementById('tableBody');

            tbody.innerHTML = currentVods.map((item, index) => {
                let tagsHtml = '';
                if (item.isAdult) tagsHtml += '<span class="tag-badge tag-19">19금</span>';
                if (item.isPaid) tagsHtml += '<span class="tag-badge tag-paid">유료</span>';

                const safeTitle = escapeHtml(item.title);
                const safeUser = escapeHtml(item.userNick || item.userId);
                const safeThumb = escapeHtml(item.thumb);
                const safeUrl = escapeHtml(item.url);

                const { deleteDateStr, ddayText } = calculateDeletionInfo(item.regDate, item.vodReadCnt);

                return \`
                    <tr>
                        <td style="color: #64748b; font-weight: bold; white-space: nowrap;">
                            \${index + 1}\${tagsHtml}
                        </td>
                        <td>
                            \` + (safeThumb ? \`
                                <a class="thumb-link" href="\${safeUrl}" target="_blank" rel="noopener noreferrer">
                                    <img class="thumb-img" src="\${safeThumb}" alt="썸네일" />
                                </a>
                            \` : '-') + \`
                        </td>
                        <td><span class="badge">\${item.vodReadCnt}회</span></td>
                        <td>
                            <a class="title-link" href="\${safeUrl}" target="_blank" rel="noopener noreferrer">\${safeTitle}</a>
                        </td>
                        <td>\${safeUser}</td>
                        <td style="font-weight: 500; white-space: nowrap;">
                            <div style="font-size: 13px; color: #334155;">등록: \${formatHourOnly(item.regDate)}</div>
                            <div style="font-size: 13px; margin-top: 2px;">
                                삭제예정: <span style="color: #0284c7; font-weight: 600;">\${deleteDateStr}</span>
                                <span class="delete-badge">\${ddayText}</span>
                            </div>
                        </td>
                        <td style="text-align: center;">
                            <a class="btn-link" href="\${safeUrl}" target="_blank" rel="noopener noreferrer">보기 ↗</a>
                        </td>
                    </tr>
                \`;
            }).join('');
        }
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`서버 실행: http://localhost:${PORT}`);
});