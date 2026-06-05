'use strict';

const MONTHLY_SHEET = '월간_누적_요약';
const RAW_DATA = 'Raw_Data';

function monthlyRawSumifFormulas() {
    const sumPaagrio = [
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "파아그리오", ${RAW_DATA}!$D:$D), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "파아그리오", ${RAW_DATA}!$E:$E), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "파아그리오", ${RAW_DATA}!$F:$F), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "파아그리오", ${RAW_DATA}!$G:$G), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "파아그리오", ${RAW_DATA}!$H:$H), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "파아그리오", ${RAW_DATA}!$I:$I), 0)`
    ];
    const sumHeine = [
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "하이네", ${RAW_DATA}!$D:$D), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "하이네", ${RAW_DATA}!$E:$E), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "하이네", ${RAW_DATA}!$F:$F), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "하이네", ${RAW_DATA}!$G:$G), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "하이네", ${RAW_DATA}!$H:$H), 0)`,
        `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "하이네", ${RAW_DATA}!$I:$I), 0)`
    ];
    const sumAll = [
        `=ROUND(SUM(${RAW_DATA}!$D:$D), 0)`,
        `=ROUND(SUM(${RAW_DATA}!$E:$E), 0)`,
        `=ROUND(SUM(${RAW_DATA}!$F:$F), 0)`,
        `=ROUND(SUM(${RAW_DATA}!$G:$G), 0)`,
        `=ROUND(SUM(${RAW_DATA}!$H:$H), 0)`,
        `=ROUND(SUM(${RAW_DATA}!$I:$I), 0)`
    ];
    return { sumPaagrio, sumHeine, sumAll };
}

/** 월간_누적_요약 = Raw_Data SUMIF만 (5~7행). 진행중/마감이력 블록 없음. */
function buildSimpleMonthlySheetBatch() {
    const { sumPaagrio, sumHeine, sumAll } = monthlyRawSumifFormulas();
    const emptyRow = () => ['', '', '', '', '', '', ''];
    return [
        { range: `'${MONTHLY_SHEET}'!B1:H1`, values: [['📊 월간/연간 누적 급여 기록 (30일 마감)', '', '', '', '', '', '']] },
        {
            range: `'${MONTHLY_SHEET}'!B3:H3`,
            values: [['마감월 / 서버명', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소']]
        },
        { range: `'${MONTHLY_SHEET}'!B4`, values: [['🟢 월간 누적 (Raw_Data — /급여기록 합계)']] },
        { range: `'${MONTHLY_SHEET}'!B5`, values: [['🔥 파아그리오']] },
        { range: `'${MONTHLY_SHEET}'!C5:H5`, values: [sumPaagrio] },
        { range: `'${MONTHLY_SHEET}'!B6`, values: [['💧 하이네']] },
        { range: `'${MONTHLY_SHEET}'!C6:H6`, values: [sumHeine] },
        { range: `'${MONTHLY_SHEET}'!B7`, values: [['🏆 현재 총합계']] },
        { range: `'${MONTHLY_SHEET}'!C7:H7`, values: [sumAll] },
        { range: `'${MONTHLY_SHEET}'!B8:H8`, values: [emptyRow()] },
        {
            range: `'${MONTHLY_SHEET}'!B9`,
            values: [['⚠️ Great 탭은 3일 지급 후 삭제됩니다. 삭제 전 /급여기록으로 Raw_Data에 마감하세요.']]
        },
        { range: `'${MONTHLY_SHEET}'!B10:H25`, values: Array.from({ length: 16 }, emptyRow) }
    ];
}

module.exports = {
    MONTHLY_SHEET,
    RAW_DATA,
    monthlyRawSumifFormulas,
    buildSimpleMonthlySheetBatch
};
