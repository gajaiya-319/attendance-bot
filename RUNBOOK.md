# 출퇴근·급여 봇 운영 RUNBOOK

로컬 PM2 프로세스 `attendance-bot` (`index.js`). 상태는 `attendanceData.json` + `logs/` + Google Sheets.

## 1. 스프레드시트 2개 (역할 분리)

| 통합문서 | env | 용도 |
|----------|-----|------|
| **Work list** | `PURCHASE_SPREADSHEET_ID` | `Paagrio Great` / `Heine Great` — **3일 급여 원본** |
| **급여토탈관리** | `PAYROLL_ARCHIVE_SPREADSHEET_ID` (보통 `PAYROLL_SUMMARY_SPREADSHEET_ID`와 동일) | `Raw_Data`, `최근_3일_요약`, `월간_누적_요약` |

- **3일 실시간:** Work list Great 탭 → 봇이 **1분마다** `최근_3일_요약`에 API 반영 (급여토탈 + Work list에 `최근_3일_요약` 탭이 있으면 둘 다).
- **월간 누적:** 급여토탈 `월간_누적_요약` **5~7행** = `Raw_Data` SUMIF만 (봇 월마감·이력 블록 **없음**).
- **마감 기록:** Discord `/급여기록` → 급여토탈 `Raw_Data`에 행 추가 (Great 탭 스냅샷).

## 2. 운영 3단계 (팀 규칙)

1. **매일·실시간** — `최근_3일_요약`만 본다 (Great와 맞는지 가끔 확인).
2. **약 75시간마다** — `/급여기록` 또는 봇 **자동** 저장 → `Raw_Data` (Great 삭제 전 필수).
3. **월말** — `월간_누적_요약` 5~7행 + `Raw_Data`로 정산 (**시트에서 수동**; 봇이 월 초기화·박제 안 함).

## 3. Discord / 자동화

| 기능 | 설명 |
|------|------|
| `/급여기록` | 서버주인만. Raw_Data append. 동시 저장 시 `archive-in-progress` |
| 자동 급여기록 | `PAYROLL_AUTO_ARCHIVE_ENABLED=true`, `PAYROLL_AUTO_ARCHIVE_HOURS=75`, **6시간마다** 체크 |
| 자동 알림 DM | 성공/실패 → `OWNER_IDS` + `PURCHASE_OWNER_DM_IDS` |
| 3일 sync 실패 | 연속 N회 실패 시 DM (`PAYROLL_LIVE_SYNC_ALERT_THRESHOLD`, 기본 3) |

## 4. 자주 쓰는 명령

```bash
npm run deploy              # 테스트 → PM2 restart → health 대기
npm run ops:health          # PM2·runtime·에러 로그
npm run ops:google-check    # 시트·키 (API 읽기)
node scripts/restore-monthly-summary-simple.js   # 월간 탭 5~7행 레이아웃 복구
npm run ops:sync-live-3day  # 3일 요약 수동 1회 동기화
```

## 5. `.env` 필수·권장

- `TOKEN` — Discord 봇
- `PURCHASE_GOOGLE_KEY_FILE` / `GOOGLE_APPLICATION_CREDENTIALS` — 서비스 계정 JSON 경로
- `PURCHASE_SPREADSHEET_ID`, `PAYROLL_ARCHIVE_SPREADSHEET_ID`
- `OWNER_IDS`, `PURCHASE_OWNER_DM_IDS` — 급여 DM 알림

선택: `PAYROLL_AUTO_ARCHIVE_*`, `PAYROLL_SYNC_WORKLIST_SUMMARY`, `PAYROLL_LIVE_SYNC_ALERT_THRESHOLD`

## 6. Heartbeat (부하 분리)

| 루프 | 주기 (기본) | env | 내용 |
|------|-------------|-----|------|
| **attendance** | 60초 | `HEARTBEAT_ATTENDANCE_MS` | 음성·출퇴근·라이브예외·휴무예약·역할·대시보드 |
| **maintenance** | 5분 | `HEARTBEAT_MAINTENANCE_MS` | 백업·패널·ops 큐·운영점검·휴무 정리 |
| **급여 3일** | 1분 cron | — | `최근_3일_요약` API sync (heartbeat와 별도) |

한 틱이 길면 `[HEARTBEAT WARN] … skipping` — attendance/maintenance는 **각각** 스킵.

## 7. 장애 대응

| 증상 | 조치 |
|------|------|
| 3일 숫자 0 / #REF | Great 탭·플레이어 열 확인 → `npm run ops:sync-live-3day` |
| `/급여기록` not-ready | Great 탭 파싱 실패; 탭 이름·Total Gain Adena 행 확인 |
| 월간 이상 레이아웃 | `node scripts/restore-monthly-summary-simple.js` 후 시트 새로고침 |
| heartbeat WARN | `npm run ops:health` → PM2 error 로그; `npm run deploy` |
| ops 큐 쌓임 | `/ops` 재시도 또는 `logs/ops-pending.json` 확인 |

## 8. 데이터 위치 (로컬)

- `attendanceData.json` — 출퇴근·휴무·라이브 예외
- `logs/payroll-operation-log.jsonl` — 급여기록 로그
- `logs/runtime-health.json` — 기동·명령 등록
- `backups/` — attendance JSON 스냅샷

비밀·키는 `.env`와 JSON 키 파일만 — git에 올리지 않음.
