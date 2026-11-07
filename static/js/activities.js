/* activities.js — 活动列表与筛选分页（由 templates/dashboard.html 拆分） */

function buildScrollableTable(html) {
            return `
                <div class="table-scroll-wrap">
                    <div class="h-scrollbar"><div class="h-scroll-inner"></div></div>
                    <div class="table-scroll">${html}</div>
                </div>
            `;
        }

        // Initialize scroll syncing between the visible top scrollbar and the table scroll area
        function initTableScrollSync() {
            const wraps = resultEl.querySelectorAll('.table-scroll-wrap');
            wraps.forEach(wrap => {
                const hScroll = wrap.querySelector('.h-scrollbar');
                const hInner = wrap.querySelector('.h-scroll-inner');
                const tableScroll = wrap.querySelector('.table-scroll');
                const table = tableScroll.querySelector('.data-table');
                if (!hScroll || !hInner || !tableScroll || !table) return;

                // set inner width to table scroll width so scrollbar appears
                const update = () => {
                    hInner.style.width = table.scrollWidth + 'px';
                };

                // Initial update and on resize
                update();
                window.addEventListener('resize', update);

                let isSyncing = false;
                tableScroll.addEventListener('scroll', () => {
                    if (isSyncing) return;
                    isSyncing = true;
                    hScroll.scrollLeft = tableScroll.scrollLeft;
                    requestAnimationFrame(() => { isSyncing = false; });
                });

                hScroll.addEventListener('scroll', () => {
                    if (isSyncing) return;
                    isSyncing = true;
                    tableScroll.scrollLeft = hScroll.scrollLeft;
                    requestAnimationFrame(() => { isSyncing = false; });
                });
            });
        }

        function getActivityLocalYearMonth(activity) {
            const localValue = activity.start_date_local;
            const localMatch = localValue && localValue.match(/^(\d{4})-(\d{2})/);
            if (localMatch) return { year: Number(localMatch[1]), month: Number(localMatch[2]) };

            if (!activity.start_date) return null;
            const date = new Date(activity.start_date);
            if (Number.isNaN(date.getTime())) return null;
            return { year: date.getFullYear(), month: date.getMonth() + 1 };
        }

        function getFilterOptions(activities) {
            const years = new Set();
            const types = new Set();
            const sportTypes = new Set();
            activities.forEach(a => {
                const date = getActivityLocalYearMonth(a);
                if (date) years.add(date.year);
                if (a.type) types.add(a.type);
                if (a.sport_type) sportTypes.add(a.sport_type);
            });
            return {
                years: Array.from(years).sort((a, b) => b - a),
                types: Array.from(types).sort(),
                sportTypes: Array.from(sportTypes).sort(),
            };
        }

        function getFilteredActivities() {
            // 时间范围与运动类型来自全局筛选栏；类型/关键字是列表本地条件
            const { start, end } = periodToDateRange(globalFilters.period, globalFilters.from, globalFilters.to);
            const startDate = start ? new Date(start + 'T00:00:00') : null;
            const endDate = end ? new Date(end + 'T23:59:59') : null;

            return allActivities.filter(a => {
                if (startDate || endDate) {
                    const dt = activityLocalDate(a);
                    if (!dt) return false;
                    if (startDate && dt < startDate) return false;
                    if (endDate && dt > endDate) return false;
                }
                if (globalFilters.sport
                    && globalFilters.sport !== a.sport_type
                    && globalFilters.sport !== a.type) return false;
                if (activityFilters.type && a.type !== activityFilters.type) return false;
                if (activityFilters.keyword) {
                    const kw = activityFilters.keyword.toLowerCase();
                    const name = (a.name || '').toLowerCase();
                    const id = String(a.id || '').toLowerCase();
                    const type = (a.type || '').toLowerCase();
                    const sportType = (a.sport_type || '').toLowerCase();
                    if (!name.includes(kw) && !id.includes(kw) && !type.includes(kw) && !sportType.includes(kw)) return false;
                }
                return true;
            });
        }

        function buildActivityFilters() {
            // 年份/月份/运动类型由顶部全局筛选栏接管，这里只保留列表本地条件
            const opts = getFilterOptions(allActivities);
            const typeOptions = opts.types.map(t => `<option value="${escapeHtml(t)}" ${activityFilters.type === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');

            return `
                <div class="filter-bar" id="activity-filter-bar">
                    <div class="filter-group">
                        <label for="activity-filter-type">类型</label>
                        <select id="activity-filter-type">
                            <option value="">全部</option>
                            ${typeOptions}
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="activity-filter-keyword">关键字</label>
                        <input type="text" id="activity-filter-keyword" value="${escapeHtml(activityFilters.keyword)}" placeholder="名称 / ID / 类型">
                    </div>
                    <button class="btn-primary" onclick="applyActivityFilters()">查询</button>
                    <button class="btn-back" onclick="resetActivityFilters()">重置</button>
                </div>
            `;
        }

        function applyActivityFilters() {
            activityFilters.type = document.getElementById('activity-filter-type').value;
            activityFilters.keyword = document.getElementById('activity-filter-keyword').value.trim();
            activityPage = 1;
            replaceParams({ type: activityFilters.type, q: activityFilters.keyword, page: 1 });
            renderActivityPage(false);
        }

        function resetActivityFilters() {
            activityFilters = { type: '', keyword: '' };
            activityPage = 1;
            replaceParams({ type: '', q: '', page: 1 });
            renderActivityPage(false);
        }

        function buildActivityTable(activities) {
            const rows = activities.map(a => `
                <tr data-activity-id="${a.id}" class="${String(a.id) === String(lastAnalyzedActivityId) ? 'analyzing' : ''}">
                    <td>${escapeHtml(a.id)}</td>
                    <td>${escapeHtml(a.name)}</td>
                    <td>${escapeHtml(a.type)}</td>
                    <td>${escapeHtml(a.sport_type)}</td>
                    <td>${formatActivityDate(a)}</td>
                    <td class="text-right">${formatDistance(a.distance)}</td>
                    <td class="text-right">${formatTime(a.moving_time)}</td>
                    <td class="text-right">${formatElevation(a.total_elevation_gain)}</td>
                    <td class="text-right">${formatSpeed(a.average_speed)}</td>
                    <td class="text-right">${formatSpeed(a.max_speed)}</td>
                    <td class="text-right">${formatCadence(a.average_cadence)}</td>
                    <td class="text-right">${formatHeartRate(a.average_heartrate)}</td>
                    <td class="text-right">${formatHeartRate(a.max_heartrate)}</td>
                    <td class="text-right">${formatWatts(a.average_watts)}</td>
                    <td class="text-right">${formatWatts(a.weighted_average_watts)}</td>
                    <td class="text-right">${formatWatts(a.max_watts)}</td>
                    <td class="text-right">${formatSufferScore(a.suffer_score)}</td>
                    <td><button class="btn-analyze" onclick="openActivityAnalysis('${a.id}')">分析</button></td>
                </tr>
            `).join('');

            return `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>名称</th>
                            <th>类型</th>
                            <th>运动类型</th>
                            <th>开始时间</th>
                            <th class="text-right">距离</th>
                            <th class="text-right">移动时间</th>
                            <th class="text-right">爬升</th>
                            <th class="text-right">平均速度</th>
                            <th class="text-right">最大速度</th>
                            <th class="text-right">平均踏频</th>
                            <th class="text-right">平均心率</th>
                            <th class="text-right">最大心率</th>
                            <th class="text-right">平均功率</th>
                            <th class="text-right">标准化功率</th>
                            <th class="text-right">最大功率</th>
                            <th class="text-right">强度评分</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
        }

        function buildPaginationControls(total) {
            const totalPages = Math.max(1, Math.ceil(total / activityPageSize));
            const start = (activityPage - 1) * activityPageSize + 1;
            const end = Math.min(activityPage * activityPageSize, total);
            return `
                <div class="pagination-bar">
                    <div class="pagination-info">
                        共 ${total} 条，第 ${start}-${end} 条，第 ${activityPage}/${totalPages} 页
                    </div>
                    <div class="pagination-controls">
                        <select class="page-size-select" id="page-size" onchange="changePageSize(this.value)">
                            <option value="20" ${activityPageSize === 20 ? 'selected' : ''}>每页 20 条</option>
                            <option value="40" ${activityPageSize === 40 ? 'selected' : ''}>每页 40 条</option>
                            <option value="100" ${activityPageSize === 100 ? 'selected' : ''}>每页 100 条</option>
                            <option value="200" ${activityPageSize === 200 ? 'selected' : ''}>每页 200 条</option>
                        </select>
                        <button class="pagination-btn" onclick="goToPage(1)" ${activityPage === 1 ? 'disabled' : ''}>首页</button>
                        <button class="pagination-btn" onclick="goToPage(${activityPage - 1})" ${activityPage === 1 ? 'disabled' : ''}>上一页</button>
                        <span class="pagination-current">${activityPage} / ${totalPages}</span>
                        <button class="pagination-btn" onclick="goToPage(${activityPage + 1})" ${activityPage === totalPages ? 'disabled' : ''}>下一页</button>
                        <button class="pagination-btn" onclick="goToPage(${totalPages})" ${activityPage === totalPages ? 'disabled' : ''}>末页</button>
                    </div>
                </div>
            `;
        }

        function renderActivityPage(shouldRestoreScroll = false) {
            const filtered = getFilteredActivities();
            const total = filtered.length;
            const totalPages = Math.max(1, Math.ceil(total / activityPageSize));
            if (activityPage > totalPages) activityPage = totalPages;
            if (activityPage < 1) activityPage = 1;

            const start = (activityPage - 1) * activityPageSize;
            const end = start + activityPageSize;
            const pageActivities = filtered.slice(start, end);

            const filtersHtml = buildActivityFilters();

            // 筛选后没有结果时给出可操作的空态，而不是渲染一张空表
            if (total === 0) {
                setHtml('活动列表', filtersHtml + buildStateBlock({
                    icon: 'empty',
                    title: '没有符合条件的活动',
                    desc: '试试放宽年份 / 月份 / 类型等条件，或清空关键字后重试。',
                    actionHtml: '<button class="btn-back" onclick="resetActivityFilters()">重置筛选</button>'
                }));
                return;
            }

            const tableHtml = buildScrollableTable(buildActivityTable(pageActivities));
            const paginationHtml = buildPaginationControls(total);
            setHtml('活动列表', filtersHtml + tableHtml + paginationHtml);
            initTableScrollSync();

            if (shouldRestoreScroll && lastAnalyzedActivityId) {
                requestAnimationFrame(() => {
                    const row = resultEl.querySelector(`tr[data-activity-id="${lastAnalyzedActivityId}"]`);
                    if (row) {
                        const tableScroll = resultEl.querySelector('.table-scroll');
                        if (tableScroll) {
                            row.scrollIntoView({ behavior: 'auto', block: 'center' });
                        }
                    }
                });
            }
        }

        function changePageSize(size) {
            activityPageSize = parseInt(size, 10);
            activityPage = 1;
            replaceParams({ pageSize: activityPageSize, page: 1 });
            renderActivityPage(true);
        }

        function goToPage(page) {
            const filtered = getFilteredActivities();
            const totalPages = Math.max(1, Math.ceil(filtered.length / activityPageSize));
            if (page < 1 || page > totalPages || page === activityPage) return;
            activityPage = page;
            replaceParams({ page: activityPage });
            renderActivityPage(false);
        }

        async function loadActivities(btn, restoreScroll = false) {
            setActiveMenu(btn);
            setLoading('活动列表（正在同步，请稍候）...');

            // 从路由参数恢复列表本地状态（分页 / 类型 / 关键字）
            const params = currentRoute ? currentRoute.params : {};
            activityFilters = { type: params.type || '', keyword: params.q || '' };
            activityPage = Math.max(1, parseInt(params.page || '1', 10) || 1);
            activityPageSize = parseInt(params.pageSize || '20', 10) || 20;

            // 「返回列表」时定位到刚分析过的活动所在页
            if (params.focus) {
                const idx = getFilteredActivities().findIndex(a => String(a.id) === String(params.focus));
                if (idx >= 0) activityPage = Math.floor(idx / activityPageSize) + 1;
                replaceParams({ focus: '' });
            }

            try {
                const data = await ensureActivitiesSynced(true);
                if (data.length === 0) {
                    pageTitleEl.textContent = '活动列表';
                    stopPageProgress();
                    resultEl.classList.remove('loading');
                    resultEl.classList.add('empty');
                    resultEl.innerHTML = buildStateBlock({
                        icon: 'empty',
                        title: '还没有同步到活动',
                        desc: 'Strava 上暂时没有可读取的活动，或授权已过期。可点「立即同步」重试，仍为空则请重新授权。',
                        actionHtml: '<button class="btn-primary" onclick="syncNow()">立即同步</button>'
                    });
                    return;
                }

                renderActivityPage(restoreScroll);
            } catch (err) {
                setError('活动列表', '请求出错: ' + err.message);
            }
        }

        // ---------- 顶栏：运动员信息与同步状态 ----------
