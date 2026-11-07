/* analysis.js — 单次活动分析面板（由 templates/dashboard.html 拆分） */

function buildAnalysisPanel(activity, data) {
            const summary = data.summary || {};
            const hasHR = data.has_hr;
            const hasWatts = data.has_watts;
            const hrInfo = hasHR ? `平均心率 ${summary.avg_heartrate || '-'} bpm` : '无心率数据';
            const powerInfo = hasWatts ? `平均功率 ${summary.avg_watts || '-'} W` : '无功率数据';
            const climbs = summary.climb_segments || [];
            const climbHtml = climbs.length ? climbs.map(c => `<span>📈 ${c.start_km}-${c.end_km} km (${c.distance_km} km)</span>`).join('') : '<span>无显著爬坡段</span>';
            return `
                <div class="analysis-header">
                    <div>
                        <div class="analysis-title">${escapeHtml(activity.name)}</div>
                        <div class="analysis-meta">
                            <span>${formatActivityDate(activity)}</span>
                            <span>${formatDistance(activity.distance)}</span>
                            <span>${formatTime(activity.moving_time)}</span>
                            <span>${formatElevation(activity.total_elevation_gain)}</span>
                            <span>${hrInfo}</span>
                            <span>${powerInfo}</span>
                        </div>
                        <div class="analysis-meta" style="margin-top:6px;">
                            <span>爬坡段 (>5%)：</span>${climbHtml}
                        </div>
                    </div>
                    <button class="btn-primary" onclick="backToActivityList()">返回列表</button>
                </div>
                <div class="analysis-chart-card" style="margin-bottom:20px;">
                    <div class="chart-title">线路轨迹（蓝色越深坡度越大，深蓝色粗线为爬坡段）</div>
                    <div id="activityRouteMap" class="route-map"></div>
                </div>
                <div class="analysis-grid">
                    <div class="analysis-chart-card">
                        <div class="chart-title">海拔剖面</div>
                        <div class="analysis-chart-wrapper"><canvas id="elevationCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card">
                        <div class="chart-title">心率曲线</div>
                        <div class="analysis-chart-wrapper"><canvas id="hrCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card">
                        <div class="chart-title">速度曲线</div>
                        <div class="analysis-chart-wrapper"><canvas id="speedCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card">
                        <div class="chart-title">功率曲线</div>
                        <div class="analysis-chart-wrapper"><canvas id="powerCanvas"></canvas></div>
                    </div>
                </div>
                <div class="analysis-grid" style="margin-top:20px;">
                    <div class="analysis-chart-card">
                        <div class="chart-title">心率-功率联动</div>
                        <div class="analysis-chart-wrapper"><canvas id="hrPowerCanvas"></canvas></div>
                    </div>
                    <div class="analysis-chart-card">
                        <div class="chart-title">海拔-坡度联动（红色为 >5% 爬坡）</div>
                        <div class="analysis-chart-wrapper"><canvas id="elevationGradeCanvas"></canvas></div>
                    </div>
                </div>
                <div class="analysis-grid" style="margin-top:20px;">
                    <div class="analysis-chart-card">
                        <div class="chart-title">心率区间分布</div>
                        <div class="analysis-chart-wrapper"><canvas id="hrZoneCanvas"></canvas></div>
                    </div>
                </div>
                <div style="text-align:center;margin-top:24px;">
                    <button class="btn-primary" onclick="openSegments('${activity.id}', '${escapeHtml(activity.name).replace(/'/g, "\\'")}')">赛段分析</button>
                    <button class="btn-back" onclick="backToActivityList()">返回列表</button>
                </div>
            `;
        }

        // 列表行「分析」入口：状态进 URL，可后退/分享
        function openActivityAnalysis(activityId) {
            navigate('activity/' + activityId);
        }

        function backToActivityList() {
            // 回到离开活动列表前的筛选与页码；focus 让列表定位到刚分析过的活动所在页
            navigate('activities', { ...lastListParams.activities, focus: lastAnalyzedActivityId || '' });
        }

        async function analyzeActivity(activityId) {
            setLoading('活动分析');
            lastAnalyzedActivityId = activityId;

            try {
                const [activities, streamsRes] = await Promise.all([
                    ensureActivitiesSynced(),
                    fetch(`/activities/${activityId}/streams`)
                ]);

                const streamsData = streamsRes.ok ? await streamsRes.json() : null;

                if (!streamsRes.ok) {
                    const errorMsg = streamsData && streamsData.error ? streamsData.error : '未知错误';
                    setHtml('活动分析', `
                        <div style="color:#c00;padding:20px 0;text-align:center;">
                            <div style="margin-bottom:16px;">获取流数据失败：${escapeHtml(errorMsg)}</div>
                            <button class="btn-primary" onclick="backToActivityList()">返回列表</button>
                        </div>
                    `);
                    return;
                }

                const activity = activities.find(a => String(a.id) === String(activityId));
                if (!activity) {
                    setHtml('活动分析', `
                        <div style="color:#c00;padding:20px 0;text-align:center;">
                            <div style="margin-bottom:16px;">未找到对应活动</div>
                            <button class="btn-primary" onclick="backToActivityList()">返回列表</button>
                        </div>
                    `);
                    return;
                }

                setHtml('活动分析', buildAnalysisPanel(activity, streamsData));
                renderAnalysisCharts(streamsData);
            } catch (err) {
                setHtml('活动分析', `
                    <div style="color:#c00;padding:20px 0;text-align:center;">
                        <div style="margin-bottom:16px;">请求出错：${escapeHtml(err.message)}</div>
                        <button class="btn-primary" onclick="backToActivityList()">返回列表</button>
                    </div>
                `);
            }
        }
