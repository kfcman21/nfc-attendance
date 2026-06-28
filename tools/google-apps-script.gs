/****************************************************************
 * NFC 학생 출석 — Google Sheets 동기화용 Apps Script
 *
 * [설치 방법]
 *  1) 구글 시트를 새로 만든다(또는 기존 시트 사용).
 *  2) 상단 메뉴 [확장 프로그램] → [Apps Script] 클릭.
 *  3) 기본 코드를 지우고 이 파일 내용을 통째로 붙여넣고 저장(💾).
 *  4) 오른쪽 위 [배포] → [새 배포] → 유형 '웹 앱' 선택.
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자"(Anyone)
 *     → [배포] 클릭 후 권한 승인.
 *  5) 표시되는 "웹 앱 URL"(https://script.google.com/macros/s/..../exec)을 복사.
 *  6) 출석 프로그램 → ⚙ 설정·진단 → 'Google Sheets 동기화'에 URL 붙여넣고
 *     [연결 테스트] → [사용]을 켜면 끝.
 *
 * 시트 두 개가 자동 생성됩니다: '출석'(태그할 때마다 한 줄씩), '주간점수'(동기화 시 갱신).
 ****************************************************************/

function doPost(e) {
  var out = { ok: true };
  try {
    var body = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.action === 'ping') {
      out.message = 'pong';

    } else if (body.action === 'append') {
      var sh = getOrCreate_(ss, '출석', ['날짜', '시각', '번호', '이름', '상태', '점수', '카드UID']);
      var r = body.row || {};
      sh.appendRow([r.date, r.time, r.number, r.name, r.status, r.score, r.card_uid]);

    } else if (body.action === 'syncWeekly') {
      var sh2 = getOrCreate_(ss, '주간점수', []);
      sh2.clear();
      var dates = body.dates || [];
      var header = ['번호', '이름'].concat(dates).concat(['합계', '정시', '지각', '결석']);
      var rows = [header];
      (body.students || []).forEach(function (s) {
        var days = s.days || {};
        var cells = dates.map(function (d) { return days[d] ? days[d].score : ''; });
        rows.push([s.number, s.name].concat(cells).concat([s.total, s.ontime, s.late, s.absent]));
      });
      sh2.getRange(1, 1, rows.length, header.length).setValues(rows);
      sh2.getRange(1, 1, 1, header.length).setFontWeight('bold');

    } else {
      out.ok = false;
      out.error = 'unknown action: ' + body.action;
    }
  } catch (err) {
    out.ok = false;
    out.error = String(err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// GET으로 열었을 때 간단 확인용
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, message: 'NFC 출석 동기화 엔드포인트가 동작 중입니다.' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreate_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (header && header.length) { sh.appendRow(header); sh.getRange(1, 1, 1, header.length).setFontWeight('bold'); }
  } else if (header && header.length && sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sh;
}
