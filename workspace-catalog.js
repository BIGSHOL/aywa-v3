/* 생성 파일 — experiments/owner-concept/catalog/build-workspace-catalog.mjs가 만든다. 손으로 고치지 말 것.
   2.0 감사 인벤토리에서 파생한 원장 작업 공간 카탈로그. 모든 동작은 로컬 미리보기·요청 초안이며 실제 쓰기·발송은 없다(liveWrites: false). */
window.AxCatalog = {
 "schemaVersion": 1,
 "source": {
  "inventorySha256": "af99e3ccd8ea53faf33bb1386de7ac109e48c5e651c1ce25c3315ed9dd154ea8",
  "sourceCommit": "3413658d6062962577a6173872cf7a260dfad346"
 },
 "liveWrites": false,
 "fieldTypes": [
  "text",
  "textarea",
  "number",
  "money",
  "date",
  "month",
  "time",
  "select",
  "multiselect",
  "checkbox",
  "student",
  "staff",
  "class",
  "subject"
 ],
 "groups": [
  {
   "id": "home",
   "label": "홈"
  },
  {
   "id": "class",
   "label": "수업"
  },
  {
   "id": "student",
   "label": "원생"
  },
  {
   "id": "operation",
   "label": "운영"
  },
  {
   "id": "support",
   "label": "지원"
  },
  {
   "id": "integration",
   "label": "연동·자동화"
  },
  {
   "id": "roles",
   "label": "역할별 화면"
  }
 ],
 "areas": [
  {
   "id": "dashboard",
   "label": "대시보드",
   "group": "홈",
   "groupId": "home",
   "page": "workspace-dashboard",
   "summary": "역할별로 배치한 지표와 카드로 학원 현황을 봅니다.",
   "viewKind": "report",
   "facets": [
    {
     "id": "kpi",
     "label": "상단 지표",
     "kind": "tab"
    },
    {
     "id": "attendance",
     "label": "출결·수업",
     "kind": "filter"
    },
    {
     "id": "students",
     "label": "학생·재원",
     "kind": "filter"
    },
    {
     "id": "admissions",
     "label": "상담·신입",
     "kind": "filter"
    },
    {
     "id": "billing",
     "label": "수납·지출",
     "kind": "filter"
    },
    {
     "id": "operations",
     "label": "학원 운영",
     "kind": "filter"
    },
    {
     "id": "announcements",
     "label": "학원 공지",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "dashboard.kpi",
     "label": "지표 다시 보기",
     "mode": "navigate",
     "target": {
      "page": "workspace-dashboard",
      "facet": "kpi"
     },
     "draft": {
      "title": "지표 다시 보기",
      "body": "재원생·강좌수·퇴원·신규문의 등 상단 지표와 카드 묶음을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "dashboard.refreshOverview",
      "dashboard.refreshClassroomPreview",
      "dashboard.saveDashboardChartKind",
      "dashboard.setOnboardingDismissed"
     ]
    },
    {
     "id": "dashboard.announcement",
     "label": "학원 공지 작성",
     "mode": "preview",
     "draft": {
      "title": "학원 공지 미리보기",
      "body": "직원에게 보일 공지 문구를 미리 확인합니다."
     },
     "fields": [
      {
       "id": "title",
       "label": "제목",
       "type": "text",
       "required": true
      },
      {
       "id": "body",
       "label": "내용",
       "type": "textarea",
       "required": true
      },
      {
       "id": "pinned",
       "label": "위에 고정",
       "type": "checkbox"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "dashboard.createAnnouncement"
     ]
    },
    {
     "id": "dashboard.briefing",
     "label": "일일 브리핑 상태",
     "mode": "preview",
     "draft": {
      "title": "일일 브리핑",
      "body": "일일 브리핑 생성은 현재 꺼져 있습니다. 이 화면의 이슈 정리로 대신 봅니다."
     },
     "fields": [],
     "result": {
      "label": "꺼진 기능 안내",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "dashboard.regenerateDailyBriefing"
     ]
    },
    {
     "id": "dashboard.layout",
     "label": "역할별 대시보드 배치",
     "mode": "navigate",
     "target": {
      "page": "workspace-owner-settings",
      "facet": "dashboard"
     },
     "draft": {
      "title": "역할별 대시보드 배치",
      "body": "원장이 역할마다 카드 배치를 정하는 설정 면으로 이동합니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "staff.dashboard-assign"
     ]
    }
   ],
   "relations": [
    "dashboard",
    "staff"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P0",
    "sourceRoutes": 3,
    "operations": 6,
    "operationIds": [
     "dashboard.refreshOverview",
     "dashboard.createAnnouncement",
     "dashboard.regenerateDailyBriefing",
     "dashboard.saveDashboardChartKind",
     "dashboard.refreshClassroomPreview",
     "dashboard.setOnboardingDismissed"
    ]
   }
  },
  {
   "id": "calendar",
   "label": "캘린더",
   "group": "홈",
   "groupId": "home",
   "page": "workspace-calendar",
   "summary": "학원 공용 일정과 보강 약속을 날짜로 봅니다.",
   "viewKind": "timeline",
   "facets": [
    {
     "id": "month",
     "label": "월",
     "kind": "tab"
    },
    {
     "id": "tags",
     "label": "일정 태그",
     "kind": "filter"
    }
   ],
   "actions": [
    {
     "id": "calendar.event",
     "label": "일정 추가",
     "mode": "preview",
     "draft": {
      "title": "일정 미리보기",
      "body": "학원 일정에 추가될 모습을 미리 봅니다."
     },
     "fields": [
      {
       "id": "title",
       "label": "일정 제목",
       "type": "text",
       "required": true
      },
      {
       "id": "start",
       "label": "시작일",
       "type": "date",
       "required": true
      },
      {
       "id": "end",
       "label": "종료일",
       "type": "date"
      },
      {
       "id": "time",
       "label": "시작 시각",
       "type": "time"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "calendar.saveCalendarEvent"
     ]
    },
    {
     "id": "calendar.tag",
     "label": "태그 만들기",
     "mode": "preview",
     "draft": {
      "title": "일정 태그",
      "body": "일정을 묶어 볼 태그 이름을 정합니다."
     },
     "fields": [
      {
       "id": "name",
       "label": "태그 이름",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "calendar.saveCalendarTag"
     ]
    }
   ],
   "relations": [
    "calendar"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 1,
    "operations": 2,
    "operationIds": [
     "calendar.saveCalendarEvent",
     "calendar.saveCalendarTag"
    ]
   }
  },
  {
   "id": "tasks-notifications",
   "label": "할 일·알림",
   "group": "홈",
   "groupId": "home",
   "page": "workspace-tasks-notifications",
   "summary": "기록에서 자동으로 생긴 할 일과 알림을 처리 상태로 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "open",
     "label": "남은 일",
     "kind": "filter"
    },
    {
     "id": "late",
     "label": "늦음",
     "kind": "filter"
    },
    {
     "id": "closed",
     "label": "끝난 일",
     "kind": "filter"
    },
    {
     "id": "inbox",
     "label": "알림함",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "tasks-notifications.inbox",
     "label": "알림함 열기",
     "mode": "navigate",
     "target": {
      "page": "inbox"
     },
     "draft": {
      "title": "알림함 열기",
      "body": "안 읽은 알림과 보관함을 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "tasks-notifications.markNotificationsRead"
     ]
    },
    {
     "id": "tasks-notifications.kind",
     "label": "할 일 종류별 보기",
     "mode": "preview",
     "draft": {
      "title": "할 일 목록",
      "body": "종류와 상태로 거른 할 일 목록을 봅니다."
     },
     "fields": [
      {
       "id": "kind",
       "label": "할 일 종류",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "report_send_failed",
         "label": "보고서 발송 실패"
        },
        {
         "value": "followup_due",
         "label": "상담 후속조치"
        },
        {
         "value": "enrollment_followup",
         "label": "콜&상담 후속 조치"
        },
        {
         "value": "progress_anomaly",
         "label": "진도 기록 이상"
        },
        {
         "value": "attendance_absent_desk",
         "label": "결석 확인 전화"
        },
        {
         "value": "video_upload_check",
         "label": "영상 업로드 확인"
        },
        {
         "value": "video_unassigned",
         "label": "미배정 영상"
        },
        {
         "value": "unsent_report",
         "label": "미발송 수업 보고서"
        },
        {
         "value": "approval_turn",
         "label": "전자결재 차례"
        },
        {
         "value": "withdrawal_step",
         "label": "퇴원보고서"
        },
        {
         "value": "help_question",
         "label": "도움말 질문"
        }
       ],
       "optionSource": "staffTaskKind"
      },
      {
       "id": "filter",
       "label": "상태",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "open",
         "label": "열린 일"
        },
        {
         "value": "late",
         "label": "늦음"
        },
        {
         "value": "closed",
         "label": "끝난 일"
        },
        {
         "value": "all",
         "label": "전체"
        }
       ],
       "optionSource": "staffTaskFilter"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "tasks-notifications.api-staff-tasks"
     ]
    },
    {
     "id": "tasks-notifications.follow",
     "label": "할 일 후속 요청",
     "mode": "request",
     "draft": {
      "title": "할 일 처리 확인 요청",
      "body": "아래 종류의 할 일이 어떻게 처리되고 있는지 확인해 알려 주세요. 할 일은 원래 기록이 바뀌어야 닫힙니다."
     },
     "fields": [
      {
       "id": "kind",
       "label": "할 일 종류",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "report_send_failed",
         "label": "보고서 발송 실패"
        },
        {
         "value": "followup_due",
         "label": "상담 후속조치"
        },
        {
         "value": "enrollment_followup",
         "label": "콜&상담 후속 조치"
        },
        {
         "value": "progress_anomaly",
         "label": "진도 기록 이상"
        },
        {
         "value": "attendance_absent_desk",
         "label": "결석 확인 전화"
        },
        {
         "value": "video_upload_check",
         "label": "영상 업로드 확인"
        },
        {
         "value": "video_unassigned",
         "label": "미배정 영상"
        },
        {
         "value": "unsent_report",
         "label": "미발송 수업 보고서"
        },
        {
         "value": "approval_turn",
         "label": "전자결재 차례"
        },
        {
         "value": "withdrawal_step",
         "label": "퇴원보고서"
        },
        {
         "value": "help_question",
         "label": "도움말 질문"
        }
       ],
       "optionSource": "staffTaskKind"
      },
      {
       "id": "memo",
       "label": "요청 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "tasks-notifications.api-staff-tasks"
     ]
    }
   ],
   "relations": [
    "tasks-notifications"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P0",
    "sourceRoutes": 0,
    "operations": 2,
    "operationIds": [
     "tasks-notifications.markNotificationsRead",
     "tasks-notifications.api-staff-tasks"
    ]
   }
  },
  {
   "id": "onescreen",
   "label": "선생님 수업보고서",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-onescreen",
   "summary": "선생님이 수업보고서를 쓰고 보내며 출결·공지·보강까지 한곳에서 마감하는 화면을 봅니다.",
   "viewKind": "sheet",
   "facets": [
    {
     "id": "reports",
     "label": "수업보고서",
     "kind": "tab"
    },
    {
     "id": "video",
     "label": "영상 제출 현황",
     "kind": "face"
    },
    {
     "id": "notice",
     "label": "학부모 공지",
     "kind": "tab"
    }
   ],
   "actions": [
    {
     "id": "onescreen.unwritten",
     "label": "보고서 작성 요청",
     "mode": "request",
     "draft": {
      "title": "수업보고서 작성 요청",
      "body": "아래 반·날짜의 수업보고서를 작성해 주세요. 작성하면 발송 큐에 올라갑니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "onescreen.saveLessonReport",
      "onescreen.saveMyReportTemplate",
      "onescreen.issueReportAttachmentUploadTicket"
     ]
    },
    {
     "id": "onescreen.ment",
     "label": "AI 멘트 미리보기",
     "mode": "preview",
     "draft": {
      "title": "AI 멘트 미리보기",
      "body": "자동작성에 들어갈 원생과 선생님 특이사항을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "notes",
       "label": "선생님 특이사항",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "입력 확인",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "onescreen.generateReportComment",
      "onescreen.savePrompt",
      "onescreen.trend-optout",
      "onescreen.ment-styles"
     ]
    },
    {
     "id": "onescreen.notice",
     "label": "학부모 공지 초안",
     "mode": "preview",
     "draft": {
      "title": "학부모 공지 미리보기",
      "body": "반 학부모에게 보낼 공지 문구를 미리 봅니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "body",
       "label": "공지 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "onescreen.sendOnescreenNotice"
     ]
    },
    {
     "id": "onescreen.makeup",
     "label": "보강 학생 등록",
     "mode": "preview",
     "draft": {
      "title": "보강 학생 등록 미리보기",
      "body": "보강 학생을 수업 명단에 올리는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "date",
       "label": "보강일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "onescreen.registerMakeupEntries",
      "class-sheets.ecs-makeup-remove"
     ]
    },
    {
     "id": "onescreen.share",
     "label": "공유 링크 재발급 요청",
     "mode": "request",
     "draft": {
      "title": "보고서 공유 링크 재발급",
      "body": "학부모 공유 링크를 다시 발급해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "사유",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "onescreen.reissueShareLink"
     ]
    }
   ],
   "relations": [
    "onescreen",
    "class-sheets"
   ],
   "meta": {
    "ownerScope": "owner-linked",
    "priority": "P0",
    "sourceRoutes": 1,
    "operations": 8,
    "operationIds": [
     "onescreen.saveLessonReport",
     "onescreen.generateReportComment",
     "onescreen.sendOnescreenNotice",
     "onescreen.registerMakeupEntries",
     "onescreen.reissueShareLink",
     "onescreen.issueReportAttachmentUploadTicket",
     "onescreen.saveMyReportTemplate",
     "onescreen.savePrompt"
    ]
   }
  },
  {
   "id": "video-homework",
   "label": "영상 숙제",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-video-homework",
   "summary": "영상 숙제 제출·배정·확인을 장부로 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "ledger",
     "label": "영상 제출 현황",
     "kind": "tab"
    },
    {
     "id": "mine",
     "label": "선생님별 장부",
     "kind": "face"
    },
    {
     "id": "site",
     "label": "숙제 영상 올리기",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "video-homework.mark",
     "label": "제출 확인 표시",
     "mode": "preview",
     "draft": {
      "title": "제출 확인 미리보기",
      "body": "장부 칸의 확인 결과를 바꾸는 내용을 미리 봅니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "date",
       "label": "숙제일",
       "type": "date",
       "required": true
      },
      {
       "id": "status",
       "label": "확인 결과",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "submitted",
         "label": "완료"
        },
        {
         "value": "missing",
         "label": "미수행"
        },
        {
         "value": "unchecked",
         "label": "미확인"
        }
       ],
       "optionSource": "videoLedgerStatus"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "video-homework.setVideoHomeworkMark"
     ]
    },
    {
     "id": "video-homework.assign",
     "label": "미배정 영상 배정 요청",
     "mode": "request",
     "draft": {
      "title": "미배정 영상 배정",
      "body": "숙제 칸에 붙지 않은 영상을 해당 숙제에 배정해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "영상·숙제 정보",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "video-homework.assignHomeworkVideo"
     ]
    },
    {
     "id": "video-homework.review",
     "label": "AI 메모 다시 분석 요청",
     "mode": "request",
     "draft": {
      "title": "영상 AI 참고 메모 다시 분석",
      "body": "아래 원생 영상의 AI 참고 메모를 다시 분석해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "video-homework.rerunVideoReview"
     ]
    },
    {
     "id": "video-homework.site",
     "label": "올리기 사이트 미리보기",
     "mode": "navigate",
     "target": {
      "page": "workspace-video-homework",
      "facet": "site"
     },
     "draft": {
      "title": "올리기 사이트 미리보기",
      "body": "학생이 휴대폰 뒷 4자리와 이름으로 영상을 올리는 공개 화면을 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "video-homework.revokeVideoSubmitLinks",
      "video-homework.api-video-submit-start"
     ]
    }
   ],
   "relations": [
    "video-homework"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 4,
    "operations": 5,
    "operationIds": [
     "video-homework.setVideoHomeworkMark",
     "video-homework.assignHomeworkVideo",
     "video-homework.rerunVideoReview",
     "video-homework.revokeVideoSubmitLinks",
     "video-homework.api-video-submit-start"
    ]
   }
  },
  {
   "id": "timetable",
   "label": "시간표",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-timetable",
   "summary": "과목별 수업 배치와 반 이동·시트 가져오기를 봅니다.",
   "viewKind": "sheet",
   "facets": [
    {
     "id": "board",
     "label": "시간표",
     "kind": "tab"
    },
    {
     "id": "editor",
     "label": "시간표 편집기",
     "kind": "face"
    },
    {
     "id": "english-sheet",
     "label": "영어 시트 반영",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "timetable.move",
     "label": "반 배치 이동 미리보기",
     "mode": "preview",
     "draft": {
      "title": "반 배치 이동 미리보기",
      "body": "반의 요일·시각을 옮긴 모습을 확인합니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "day",
       "label": "요일",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "mon",
         "label": "월"
        },
        {
         "value": "tue",
         "label": "화"
        },
        {
         "value": "wed",
         "label": "수"
        },
        {
         "value": "thu",
         "label": "목"
        },
        {
         "value": "fri",
         "label": "금"
        },
        {
         "value": "sat",
         "label": "토"
        },
        {
         "value": "sun",
         "label": "일"
        }
       ],
       "optionSource": "weekday"
      },
      {
       "id": "start",
       "label": "시작 시각",
       "type": "time",
       "required": true
      },
      {
       "id": "effective",
       "label": "적용일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "timetable.moveClassSlots",
      "timetable.createClassSplit"
     ]
    },
    {
     "id": "timetable.import",
     "label": "시트 가져오기 요청",
     "mode": "request",
     "draft": {
      "title": "시간표 시트 가져오기",
      "body": "시트에서 바뀐 내용을 미리보기로 확인한 뒤 적용일부터 반영해 주세요."
     },
     "fields": [
      {
       "id": "subject",
       "label": "과목",
       "type": "subject",
       "required": true
      },
      {
       "id": "effective",
       "label": "적용일",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "timetable.previewSheetImport",
      "timetable.previewMathSheetBundle",
      "timetable.previewMasterSheet"
     ]
    },
    {
     "id": "timetable.editor",
     "label": "편집기 연습본",
     "mode": "navigate",
     "target": {
      "page": "workspace-timetable",
      "facet": "editor"
     },
     "draft": {
      "title": "편집기 연습본",
      "body": "운영과 분리된 연습본에서 다음 시간표를 짜 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "timetable.previewTimetableLabApply"
     ]
    },
    {
     "id": "timetable.memo",
     "label": "메모 시트 보기",
     "mode": "preview",
     "draft": {
      "title": "영어 메모 시트",
      "body": "영어 통합뷰 옆 메모 시트의 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "memo",
       "label": "메모 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "timetable.saveMemoSheet"
     ]
    }
   ],
   "relations": [
    "timetable"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 3,
    "operations": 7,
    "operationIds": [
     "timetable.moveClassSlots",
     "timetable.previewSheetImport",
     "timetable.previewMathSheetBundle",
     "timetable.previewMasterSheet",
     "timetable.previewTimetableLabApply",
     "timetable.saveMemoSheet",
     "timetable.createClassSplit"
    ]
   }
  },
  {
   "id": "class-sheets",
   "label": "강사 시트",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-class-sheets",
   "summary": "영어·수학 강사 시트의 목표·수업계획·진도를 봅니다.",
   "viewKind": "sheet",
   "facets": [
    {
     "id": "ecs",
     "label": "영어",
     "kind": "tab"
    },
    {
     "id": "ecs-month",
     "label": "월간",
     "kind": "face"
    },
    {
     "id": "goals",
     "label": "반 계획 보기",
     "kind": "face"
    },
    {
     "id": "plan-gap",
     "label": "계획 대비 현황",
     "kind": "face"
    },
    {
     "id": "mcs",
     "label": "수학",
     "kind": "tab"
    },
    {
     "id": "mcs-teachers",
     "label": "선생님별",
     "kind": "face"
    },
    {
     "id": "progress-map",
     "label": "수학 학습 진도맵",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "class-sheets.goal",
     "label": "반 목표 미리보기",
     "mode": "preview",
     "draft": {
      "title": "반 목표 미리보기",
      "body": "영어 반의 월간·주간 목표 문구를 확인합니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "scope",
       "label": "범위",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "month",
         "label": "월간 목표"
        },
        {
         "value": "week",
         "label": "주간 목표"
        }
       ],
       "optionSource": "inline-verified"
      },
      {
       "id": "goal",
       "label": "목표",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "class-sheets.upsertGoal",
      "class-sheets.saveMonthPlanCells",
      "class-sheets.copyWeekFromPrevious",
      "attendance.seat-plan"
     ]
    },
    {
     "id": "class-sheets.missing",
     "label": "시트 작성 요청",
     "mode": "request",
     "draft": {
      "title": "강사 시트 작성 요청",
      "body": "아래 반·주의 강사 시트(출결·진도·표시)를 채워 주세요."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "week",
       "label": "주(월요일)",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "class-sheets.upsertStudentMark",
      "class-sheets.pullEcsMemorizedWords",
      "attendance.seat-jj",
      "class-sheets.shouting"
     ]
    },
    {
     "id": "class-sheets.gap",
     "label": "계획 대비 현황",
     "mode": "navigate",
     "target": {
      "page": "workspace-class-sheets",
      "facet": "plan-gap"
     },
     "draft": {
      "title": "계획 대비 현황",
      "body": "선생님별로 실제 수업이 원래 월간계획과 얼마나 달랐는지 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "textbooks.plan-compare"
     ]
    },
    {
     "id": "class-sheets.math",
     "label": "수학 학습 목표 미리보기",
     "mode": "preview",
     "draft": {
      "title": "수학 학습 목표",
      "body": "수학 반의 월 목표 차시를 확인합니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "month",
       "label": "월",
       "type": "month",
       "required": true
      },
      {
       "id": "goal",
       "label": "목표 차시",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "class-sheets.saveMathLearningGoals",
      "class-sheets.mcs-goals"
     ]
    }
   ],
   "relations": [
    "class-sheets",
    "attendance",
    "textbooks"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 10,
    "operations": 6,
    "operationIds": [
     "class-sheets.upsertGoal",
     "class-sheets.upsertStudentMark",
     "class-sheets.copyWeekFromPrevious",
     "class-sheets.saveMonthPlanCells",
     "class-sheets.pullEcsMemorizedWords",
     "class-sheets.saveMathLearningGoals"
    ]
   }
  },
  {
   "id": "attendance",
   "label": "출석부",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-attendance",
   "summary": "월별 출석부·오늘 출결·자리 출석부·키오스크를 봅니다.",
   "viewKind": "sheet",
   "facets": [
    {
     "id": "monthly",
     "label": "월별 출석부",
     "kind": "tab"
    },
    {
     "id": "live",
     "label": "오늘 출결",
     "kind": "tab"
    },
    {
     "id": "quick",
     "label": "출결 모드",
     "kind": "tab"
    },
    {
     "id": "date",
     "label": "날짜별 입력",
     "kind": "face"
    },
    {
     "id": "seat",
     "label": "랩실·JJ실 출석부",
     "kind": "face"
    },
    {
     "id": "stats",
     "label": "출결 통계",
     "kind": "face"
    },
    {
     "id": "units",
     "label": "시수 마스터",
     "kind": "face"
    },
    {
     "id": "kiosk",
     "label": "키오스크 설정",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "attendance.mark",
     "label": "출결 기록 미리보기",
     "mode": "preview",
     "draft": {
      "title": "출결 기록 미리보기",
      "body": "출결 칸에 들어갈 상태와 사유를 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "status",
       "label": "출결",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "present",
         "label": "출석"
        },
        {
         "value": "absent",
         "label": "결석"
        },
        {
         "value": "late",
         "label": "지각"
        },
        {
         "value": "early_leave",
         "label": "조퇴"
        },
        {
         "value": "makeup",
         "label": "보강"
        },
        {
         "value": "excused",
         "label": "공결"
        }
       ],
       "optionSource": "attendanceStatus"
      },
      {
       "id": "memo",
       "label": "사유",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "attendance.setAttendanceCell",
      "attendance.setSeatCell",
      "class-sheets.ecs-attendance"
     ]
    },
    {
     "id": "attendance.absence-call",
     "label": "결석 확인 전화 요청",
     "mode": "request",
     "draft": {
      "title": "결석 확인 전화",
      "body": "결석한 원생의 사유를 보호자에게 확인하고 보강 필요 여부를 알려 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "확인할 내용",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "attendance.requestDeskConfirm"
     ]
    },
    {
     "id": "attendance.intake",
     "label": "결석 사전 접수",
     "mode": "preview",
     "draft": {
      "title": "결석 사전 접수 미리보기",
      "body": "보호자가 미리 알린 결석을 접수했을 때 영향을 받는 수업을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "from",
       "label": "시작일",
       "type": "date",
       "required": true
      },
      {
       "id": "to",
       "label": "종료일",
       "type": "date"
      },
      {
       "id": "memo",
       "label": "사유",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "attendance.previewAbsenceIntake"
     ]
    },
    {
     "id": "attendance.makeup",
     "label": "보강 예약",
     "mode": "preview",
     "draft": {
      "title": "보강 예약 미리보기",
      "body": "결석 칸과 보강 날짜·교시를 맞춰 봅니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "absence",
       "label": "결석일",
       "type": "date",
       "required": true
      },
      {
       "id": "makeup",
       "label": "보강일",
       "type": "date",
       "required": true
      },
      {
       "id": "slot",
       "label": "교시 시각",
       "type": "time"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "attendance.reserveMakeup"
     ]
    },
    {
     "id": "attendance.recap",
     "label": "출결 요약 보기",
     "mode": "preview",
     "draft": {
      "title": "출결 요약",
      "body": "기간의 출결 집계를 봅니다."
     },
     "fields": [
      {
       "id": "from",
       "label": "시작일",
       "type": "date",
       "required": true
      },
      {
       "id": "to",
       "label": "종료일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "집계 미리보기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "attendance.generateRecapSummary"
     ]
    },
    {
     "id": "attendance.kiosk",
     "label": "출석 키오스크 설정",
     "mode": "navigate",
     "target": {
      "page": "workspace-attendance",
      "facet": "kiosk"
     },
     "draft": {
      "title": "출석 키오스크 설정",
      "body": "출석 키오스크 기기와 알림 설정을 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "attendance.registerKioskDevice",
      "attendance.api-attendance-checkin"
     ]
    },
    {
     "id": "attendance.salary",
     "label": "실급여 비율",
     "mode": "navigate",
     "target": {
      "page": "workspace-attendance",
      "facet": "monthly"
     },
     "draft": {
      "title": "실급여 비율",
      "body": "선생님별 실급여 비율과 표시 여부를 월별 출석부에서 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "attendance.saveAttendanceSalaryRates"
     ]
    }
   ],
   "relations": [
    "attendance",
    "class-sheets"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P0",
    "sourceRoutes": 16,
    "operations": 9,
    "operationIds": [
     "attendance.setAttendanceCell",
     "attendance.requestDeskConfirm",
     "attendance.previewAbsenceIntake",
     "attendance.reserveMakeup",
     "attendance.generateRecapSummary",
     "attendance.setSeatCell",
     "attendance.registerKioskDevice",
     "attendance.saveAttendanceSalaryRates",
     "attendance.api-attendance-checkin"
    ]
   }
  },
  {
   "id": "classes",
   "label": "수업목록",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-classes",
   "summary": "반 목록과 반 상세(수강생·시간표·인수인계)를 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "list",
     "label": "수업목록",
     "kind": "tab"
    },
    {
     "id": "detail",
     "label": "반 상세",
     "kind": "face"
    },
    {
     "id": "new",
     "label": "새 반",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "classes.legacy",
     "label": "반 목록 열기",
     "mode": "navigate",
     "target": {
      "page": "classes"
     },
     "draft": {
      "title": "반 목록 열기",
      "body": "수업·시간표 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "classes.open",
     "label": "반 개설 요청",
     "mode": "request",
     "draft": {
      "title": "반 개설 요청",
      "body": "아래 조건으로 새 반을 만들어 주세요."
     },
     "fields": [
      {
       "id": "name",
       "label": "반 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "staff",
       "label": "담임",
       "type": "staff",
       "required": true
      },
      {
       "id": "day",
       "label": "요일",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "mon",
         "label": "월"
        },
        {
         "value": "tue",
         "label": "화"
        },
        {
         "value": "wed",
         "label": "수"
        },
        {
         "value": "thu",
         "label": "목"
        },
        {
         "value": "fri",
         "label": "금"
        },
        {
         "value": "sat",
         "label": "토"
        },
        {
         "value": "sun",
         "label": "일"
        }
       ],
       "optionSource": "weekday"
      },
      {
       "id": "start",
       "label": "시작 시각",
       "type": "time"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "classes.createClass"
     ]
    },
    {
     "id": "classes.handover",
     "label": "담임 인수인계 예약",
     "mode": "preview",
     "draft": {
      "title": "인수인계 예약 미리보기",
      "body": "적용일부터 담임이 바뀌는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "staff",
       "label": "새 담임",
       "type": "staff",
       "required": true
      },
      {
       "id": "effective",
       "label": "적용일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "classes.scheduleHandover"
     ]
    },
    {
     "id": "classes.delegation",
     "label": "결근 대체 위임",
     "mode": "preview",
     "draft": {
      "title": "결근 대체 위임 미리보기",
      "body": "기간 동안 다른 선생님이 반을 맡는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "staff",
       "label": "대신 맡을 선생님",
       "type": "staff",
       "required": true
      },
      {
       "id": "from",
       "label": "시작일",
       "type": "date",
       "required": true
      },
      {
       "id": "to",
       "label": "종료일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "classes.createClassDelegation"
     ]
    },
    {
     "id": "classes.enroll",
     "label": "수강 배정",
     "mode": "preview",
     "draft": {
      "title": "수강 배정 미리보기",
      "body": "원생을 반에 배정하는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "start",
       "label": "시작일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "classes.createEnrollment",
      "classes.rescheduleEnrollment"
     ]
    },
    {
     "id": "classes.term-end",
     "label": "운영 기간 종료 요청",
     "mode": "request",
     "draft": {
      "title": "반 운영 기간 종료",
      "body": "아래 반의 운영 기간을 종료해 주세요. 열린 수강은 종료일로 닫힙니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "end",
       "label": "종료일",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "classes.endClassTerm"
     ]
    },
    {
     "id": "classes.classroom-auto",
     "label": "강의실 자동배정 미리보기",
     "mode": "preview",
     "draft": {
      "title": "강의실 자동배정 미리보기",
      "body": "반마다 강의실을 자동으로 정했을 때 바뀌는 반만 확인합니다."
     },
     "fields": [],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "classes.classroom-auto"
     ]
    },
    {
     "id": "classes.level",
     "label": "반 레벨 변경 요청",
     "mode": "request",
     "draft": {
      "title": "반 레벨 변경",
      "body": "아래 영어 반의 이름을 레벨 규칙에 따라 바꿔 주세요(예: DP3 → DP4). 같은 이름의 반이 이미 있으면 바뀌지 않습니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "change",
       "label": "변경",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "number-up",
         "label": "숫자 올리기"
        },
        {
         "value": "number-down",
         "label": "숫자 내리기"
        },
        {
         "value": "class-up",
         "label": "레벨 올리기"
        },
        {
         "value": "class-down",
         "label": "레벨 내리기"
        }
       ],
       "optionSource": "inline-verified"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "timetable.class-level"
     ]
    }
   ],
   "relations": [
    "classes",
    "timetable"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 4,
    "operations": 6,
    "operationIds": [
     "classes.createClass",
     "classes.endClassTerm",
     "classes.scheduleHandover",
     "classes.createClassDelegation",
     "classes.createEnrollment",
     "classes.rescheduleEnrollment"
    ]
   }
  },
  {
   "id": "makeups",
   "label": "보강관리",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-makeups",
   "summary": "보강 사례를 접수부터 인정·종결까지 단계로 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "cases",
     "label": "보강관리",
     "kind": "tab"
    },
    {
     "id": "candidates",
     "label": "미연결 근거",
     "kind": "face"
    },
    {
     "id": "dry-run",
     "label": "도입 사전 점검",
     "kind": "face"
    },
    {
     "id": "reconciliation",
     "label": "대사·복구",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "makeups.intake",
     "label": "보강 접수",
     "mode": "preview",
     "draft": {
      "title": "보강 접수 미리보기",
      "body": "보강 사례가 접수되는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "reason",
       "label": "보강 사유",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "absence",
         "label": "결석"
        },
        {
         "value": "planned_absence",
         "label": "예정 결석"
        },
        {
         "value": "class_cancelled",
         "label": "휴강"
        },
        {
         "value": "additional",
         "label": "추가 보강"
        },
        {
         "value": "imported",
         "label": "기존 보강 예약"
        }
       ],
       "optionSource": "makeupReason"
      },
      {
       "id": "original",
       "label": "원래 수업일",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "makeups.executeMakeupCommand"
     ]
    },
    {
     "id": "makeups.plan",
     "label": "보강 계획",
     "mode": "preview",
     "draft": {
      "title": "보강 처리 미리보기",
      "body": "선택한 처리(예약·일정 변경·인정 등)를 적용했을 때의 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "action",
       "label": "처리",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "intake",
         "label": "보강 접수"
        },
        {
         "value": "approve",
         "label": "보강 시간 승인"
        },
        {
         "value": "deny",
         "label": "자격 거절"
        },
        {
         "value": "assign",
         "label": "담당·기한 지정"
        },
        {
         "value": "reserve",
         "label": "예약"
        },
        {
         "value": "reschedule",
         "label": "일정 변경"
        },
        {
         "value": "cancel",
         "label": "예약 취소"
        },
        {
         "value": "participation",
         "label": "참여 기록"
        },
        {
         "value": "submit",
         "label": "검토 제출"
        },
        {
         "value": "verify",
         "label": "실시 인정"
        },
        {
         "value": "reverse",
         "label": "인정 정정"
        },
        {
         "value": "waive",
         "label": "분량 면제"
        },
        {
         "value": "adjust",
         "label": "분량·기한 조정"
        },
        {
         "value": "hold",
         "label": "보류"
        },
        {
         "value": "resume",
         "label": "재개"
        },
        {
         "value": "close",
         "label": "종결"
        },
        {
         "value": "link_legacy",
         "label": "기존 보강 예약 연결"
        },
        {
         "value": "resolve_reconciliation",
         "label": "대사 처리"
        },
        {
         "value": "reconcile",
         "label": "대사 실행"
        },
        {
         "value": "configure",
         "label": "운영 설정"
        },
        {
         "value": "review",
         "label": "검토"
        },
        {
         "value": "record",
         "label": "기록"
        },
        {
         "value": "none",
         "label": "업무 없음"
        },
        {
         "value": "review_hold",
         "label": "보류 재검토"
        },
        {
         "value": "review_eligibility",
         "label": "승인 검토"
        },
        {
         "value": "assign_owner",
         "label": "담당 지정"
        },
        {
         "value": "schedule",
         "label": "예약"
        },
        {
         "value": "await_session",
         "label": "예약 실시 대기"
        }
       ],
       "optionSource": "makeupAction"
      },
      {
       "id": "due",
       "label": "기한",
       "type": "date"
      },
      {
       "id": "staff",
       "label": "담당",
       "type": "staff"
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "makeups.executeMakeupCommand",
      "makeups.searchMakeupOptions"
     ]
    },
    {
     "id": "makeups.owner",
     "label": "보강 담당 지정 요청",
     "mode": "request",
     "draft": {
      "title": "보강 담당 지정",
      "body": "아래 보강 사례를 맡아 기한까지 처리해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "staff",
       "label": "담당",
       "type": "staff",
       "required": true
      },
      {
       "id": "due",
       "label": "기한",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "makeups.executeMakeupCommand"
     ]
    },
    {
     "id": "makeups.history",
     "label": "보강 이력",
     "mode": "navigate",
     "target": {
      "page": "workspace-makeups",
      "facet": "cases"
     },
     "draft": {
      "title": "보강 이력",
      "body": "보강 사례의 처리 이력을 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "makeups.loadMakeupEvents"
     ]
    }
   ],
   "relations": [
    "makeups"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 6,
    "operations": 3,
    "operationIds": [
     "makeups.executeMakeupCommand",
     "makeups.searchMakeupOptions",
     "makeups.loadMakeupEvents"
    ]
   }
  },
  {
   "id": "textbooks",
   "label": "교재목록",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-textbooks",
   "summary": "수업 교재와 차수별 진도·과제, 반 배정을 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "books",
     "label": "교재",
     "kind": "tab"
    },
    {
     "id": "plans",
     "label": "반 배정",
     "kind": "tab"
    }
   ],
   "actions": [
    {
     "id": "textbooks.book",
     "label": "교재 미리보기",
     "mode": "preview",
     "draft": {
      "title": "교재 미리보기",
      "body": "교재와 차수 구성을 확인합니다."
     },
     "fields": [
      {
       "id": "title",
       "label": "교재 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "lessons",
       "label": "차수",
       "type": "number",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "textbooks.saveTextbook",
      "textbooks.registerTextbookCover"
     ]
    },
    {
     "id": "textbooks.fill",
     "label": "반 배정 채우기",
     "mode": "preview",
     "draft": {
      "title": "반 배정 미리보기",
      "body": "반의 수업일에 차수를 차례로 채운 모습을 봅니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "start",
       "label": "시작일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "textbooks.previewTextbookFill",
      "textbooks.saveMathTextbookAssignment"
     ]
    },
    {
     "id": "textbooks.shift",
     "label": "회차 미룸·당김 요청",
     "mode": "request",
     "draft": {
      "title": "수업 회차 조정",
      "body": "아래 반·날짜의 수업 회차를 조정해 주세요."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "direction",
       "label": "방향",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "skip",
         "label": "미룸"
        },
        {
         "value": "advance",
         "label": "당김"
        }
       ],
       "optionSource": "inline-verified"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "textbooks.setLessonShift"
     ]
    }
   ],
   "relations": [
    "textbooks"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 1,
    "operations": 5,
    "operationIds": [
     "textbooks.saveTextbook",
     "textbooks.registerTextbookCover",
     "textbooks.previewTextbookFill",
     "textbooks.setLessonShift",
     "textbooks.saveMathTextbookAssignment"
    ]
   }
  },
  {
   "id": "lesson-reports",
   "label": "수업보고서",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-lesson-reports",
   "summary": "수업보고서 작성률·목록과 ClassNote 발송을 봅니다.",
   "viewKind": "report",
   "facets": [
    {
     "id": "writing",
     "label": "작성률",
     "kind": "tab"
    },
    {
     "id": "list",
     "label": "목록",
     "kind": "tab"
    },
    {
     "id": "queue",
     "label": "발송 큐",
     "kind": "tab"
    },
    {
     "id": "boards",
     "label": "반 구성",
     "kind": "tab"
    },
    {
     "id": "notice",
     "label": "반 공지",
     "kind": "tab"
    },
    {
     "id": "compose",
     "label": "직접 발송",
     "kind": "tab"
    },
    {
     "id": "recall",
     "label": "회수",
     "kind": "tab"
    },
    {
     "id": "parent_replies",
     "label": "학부모 글·답글",
     "kind": "tab"
    },
    {
     "id": "report",
     "label": "보고서 설정",
     "kind": "tab"
    },
    {
     "id": "ai_ment",
     "label": "AI 멘트",
     "kind": "tab"
    },
    {
     "id": "stats",
     "label": "보고서 통계",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "lesson-reports.queue",
     "label": "발송 큐 보기",
     "mode": "navigate",
     "target": {
      "page": "workspace-lesson-reports",
      "facet": "queue"
     },
     "draft": {
      "title": "발송 큐 보기",
      "body": "발송 대기·실패·보류 보고서를 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "lesson-reports.refreshClassnoteQueue",
      "lesson-reports.listReports"
     ]
    },
    {
     "id": "lesson-reports.compose",
     "label": "직접 작성 미리보기",
     "mode": "preview",
     "draft": {
      "title": "수업보고서 미리보기",
      "body": "학부모에게 보일 보고서 카드를 미리 봅니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "body",
       "label": "보고서 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "lesson-reports.saveAdminReport"
     ]
    },
    {
     "id": "lesson-reports.notice",
     "label": "반 공지 미리보기",
     "mode": "preview",
     "draft": {
      "title": "반 공지 미리보기",
      "body": "반 보드에 올릴 공지를 미리 봅니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "body",
       "label": "공지 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "lesson-reports.previewClassNotice"
     ]
    },
    {
     "id": "lesson-reports.recall",
     "label": "보고서 회수 요청",
     "mode": "request",
     "draft": {
      "title": "보고서 회수",
      "body": "아래 보고서를 학부모 알림장에서 회수해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "회수 사유",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "lesson-reports.requestReportRecall"
     ]
    },
    {
     "id": "lesson-reports.board",
     "label": "반 보드 원아 연결 요청",
     "mode": "request",
     "draft": {
      "title": "ClassNote 반 보드 연결",
      "body": "원생을 해당 반 보드의 원아와 연결해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "lesson-reports.linkClassnoteChild"
     ]
    },
    {
     "id": "lesson-reports.reply",
     "label": "학부모 글 답글 초안",
     "mode": "preview",
     "draft": {
      "title": "학부모 답글 미리보기",
      "body": "학부모 글에 남길 답글을 미리 봅니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "body",
       "label": "답글",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "lesson-reports.requestParentReply"
     ]
    },
    {
     "id": "lesson-reports.parents",
     "label": "학부모 소통 보기",
     "mode": "navigate",
     "target": {
      "page": "parents"
     },
     "draft": {
      "title": "학부모 소통 보기",
      "body": "학부모 소통 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    }
   ],
   "relations": [
    "lesson-reports"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P0",
    "sourceRoutes": 4,
    "operations": 7,
    "operationIds": [
     "lesson-reports.refreshClassnoteQueue",
     "lesson-reports.saveAdminReport",
     "lesson-reports.previewClassNotice",
     "lesson-reports.requestReportRecall",
     "lesson-reports.linkClassnoteChild",
     "lesson-reports.requestParentReply",
     "lesson-reports.listReports"
    ]
   }
  },
  {
   "id": "class-review",
   "label": "직원 평가",
   "group": "수업",
   "groupId": "class",
   "page": "workspace-class-review",
   "summary": "수업 참관 평가와 직원 포트폴리오를 봅니다.",
   "viewKind": "report",
   "facets": [
    {
     "id": "review",
     "label": "직원 평가",
     "kind": "tab"
    },
    {
     "id": "portfolio",
     "label": "직원 포트폴리오",
     "kind": "tab"
    },
    {
     "id": "board",
     "label": "직원 평가 종합",
     "kind": "face"
    },
    {
     "id": "template",
     "label": "문항 편집",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "class-review.open",
     "label": "참관 평가 개설 요청",
     "mode": "request",
     "draft": {
      "title": "수업 참관 평가",
      "body": "아래 선생님의 수업을 참관해 평가해 주세요."
     },
     "fields": [
      {
       "id": "staff",
       "label": "평가 대상 선생님",
       "type": "staff",
       "required": true
      },
      {
       "id": "staff",
       "label": "평가자",
       "type": "staff",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "class-review.createClassReview"
     ]
    },
    {
     "id": "class-review.portfolio",
     "label": "직원 포트폴리오",
     "mode": "navigate",
     "target": {
      "page": "workspace-class-review",
      "facet": "portfolio"
     },
     "draft": {
      "title": "직원 포트폴리오",
      "body": "항목별 점수와 근거를 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "class-review.refreshTeacherPortfolioNow",
      "class-review.decideJudgment"
     ]
    },
    {
     "id": "class-review.criteria",
     "label": "평가 기준",
     "mode": "navigate",
     "target": {
      "page": "workspace-owner-settings",
      "facet": "evaluation"
     },
     "draft": {
      "title": "평가 기준",
      "body": "강사평가 지표·만점을 정하는 설정 면으로 이동합니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "class-review.saveEvaluationSettings",
      "class-review.saveChecklistTemplate"
     ]
    }
   ],
   "relations": [
    "class-review"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 6,
    "operations": 5,
    "operationIds": [
     "class-review.createClassReview",
     "class-review.saveChecklistTemplate",
     "class-review.refreshTeacherPortfolioNow",
     "class-review.decideJudgment",
     "class-review.saveEvaluationSettings"
    ]
   }
  },
  {
   "id": "students",
   "label": "원생목록",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-students",
   "summary": "원생 명단과 원생 상세(수업·성적·출결·상담·수납 등)를 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "list",
     "label": "원생목록",
     "kind": "tab"
    },
    {
     "id": "stats",
     "label": "원생 통계",
     "kind": "face"
    },
    {
     "id": "overview",
     "label": "개요",
     "kind": "tab"
    },
    {
     "id": "classes",
     "label": "수업",
     "kind": "tab"
    },
    {
     "id": "grades",
     "label": "성적",
     "kind": "tab"
    },
    {
     "id": "srs",
     "label": "SRS",
     "kind": "tab"
    },
    {
     "id": "todays-math",
     "label": "오늘 수학",
     "kind": "tab"
    },
    {
     "id": "progress",
     "label": "진도",
     "kind": "tab"
    },
    {
     "id": "homework-videos",
     "label": "숙제 영상",
     "kind": "tab"
    },
    {
     "id": "attendance",
     "label": "출결",
     "kind": "tab"
    },
    {
     "id": "consultations",
     "label": "상담",
     "kind": "tab"
    },
    {
     "id": "memos",
     "label": "특이사항",
     "kind": "tab"
    },
    {
     "id": "billing",
     "label": "수납",
     "kind": "tab"
    },
    {
     "id": "contribution",
     "label": "기여도",
     "kind": "tab"
    },
    {
     "id": "timeline",
     "label": "타임라인",
     "kind": "tab"
    }
   ],
   "actions": [
    {
     "id": "students.legacy",
     "label": "원생 화면 열기",
     "mode": "navigate",
     "target": {
      "page": "students"
     },
     "draft": {
      "title": "원생 화면 열기",
      "body": "원생 검색·상세 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "students.register",
     "label": "원생 등록 요청",
     "mode": "request",
     "draft": {
      "title": "원생 등록",
      "body": "아래 원생을 등록해 주세요."
     },
     "fields": [
      {
       "id": "name",
       "label": "이름",
       "type": "text",
       "required": true
      },
      {
       "id": "school",
       "label": "학교",
       "type": "text"
      },
      {
       "id": "grade",
       "label": "학년",
       "type": "text"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "students.createStudent",
      "students.updateStudentEnglishName"
     ]
    },
    {
     "id": "students.status",
     "label": "상태 전환 미리보기",
     "mode": "preview",
     "draft": {
      "title": "상태 전환 미리보기",
      "body": "재원·휴원 전환 내용을 확인합니다. 퇴원은 퇴원보고서로만 처리됩니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "status",
       "label": "바꿀 상태",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "enrolled",
         "label": "재원"
        },
        {
         "value": "on_hold",
         "label": "휴원"
        }
       ],
       "optionSource": "studentStatus"
      },
      {
       "id": "effective",
       "label": "적용일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "students.changeStudentStatus"
     ]
    },
    {
     "id": "students.end",
     "label": "수강 종료 미리보기",
     "mode": "preview",
     "draft": {
      "title": "수강 종료 미리보기",
      "body": "과목 수강을 종료할 때의 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "end",
       "label": "종료일",
       "type": "date",
       "required": true
      },
      {
       "id": "reason",
       "label": "종료 사유",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "dissatisfaction",
         "label": "수업·강사"
        },
        {
         "value": "grades",
         "label": "성적"
        },
        {
         "value": "motivation",
         "label": "학생 상태"
        },
        {
         "value": "method",
         "label": "공부 방법 변경"
        },
        {
         "value": "competitor",
         "label": "타 학원으로 이동"
        },
        {
         "value": "schedule",
         "label": "시간/일정"
        },
        {
         "value": "financial",
         "label": "경제적 이유"
        },
        {
         "value": "career",
         "label": "진로·진학"
        },
        {
         "value": "peers",
         "label": "가족·친구"
        },
        {
         "value": "illness",
         "label": "질병"
        },
        {
         "value": "advised",
         "label": "권고퇴원"
        },
        {
         "value": "relocation",
         "label": "이사"
        },
        {
         "value": "graduated",
         "label": "졸업"
        },
        {
         "value": "other",
         "label": "기타"
        }
       ],
       "optionSource": "withdrawalReason"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "students.endStudentEnrollments"
     ]
    },
    {
     "id": "students.memo",
     "label": "특이사항 메모",
     "mode": "preview",
     "draft": {
      "title": "특이사항 미리보기",
      "body": "원생 상세에 남길 특이사항을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "body",
       "label": "특이사항",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "students.createStudentMemo"
     ]
    },
    {
     "id": "students.grade",
     "label": "성적 기록",
     "mode": "preview",
     "draft": {
      "title": "성적 기록 미리보기",
      "body": "원생 성적 기록을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "taken",
       "label": "시험일",
       "type": "date",
       "required": true
      },
      {
       "id": "score",
       "label": "점수",
       "type": "number",
       "required": true
      },
      {
       "id": "max",
       "label": "만점",
       "type": "number"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "students.createStudentGrade"
     ]
    },
    {
     "id": "students.progress",
     "label": "진도 이상 확인 요청",
     "mode": "request",
     "draft": {
      "title": "진도 기록 이상 확인",
      "body": "진도 기록 이상을 확인하고 처리 결과를 알려 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "확인할 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "students.setProgressAnomalyResolved"
     ]
    }
   ],
   "relations": [
    "students"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P0",
    "sourceRoutes": 5,
    "operations": 7,
    "operationIds": [
     "students.createStudent",
     "students.changeStudentStatus",
     "students.endStudentEnrollments",
     "students.createStudentMemo",
     "students.createStudentGrade",
     "students.updateStudentEnglishName",
     "students.setProgressAnomalyResolved"
    ]
   }
  },
  {
   "id": "student-contribution",
   "label": "원생 기여도",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-student-contribution",
   "summary": "원생별 운영 기여·학습 참여·연결 기록을 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "list",
     "label": "원생 기여도",
     "kind": "tab"
    },
    {
     "id": "ontology",
     "label": "학생 기록의 연결",
     "kind": "face"
    },
    {
     "id": "referrals",
     "label": "지난 소개 확인",
     "kind": "face"
    },
    {
     "id": "settings",
     "label": "기여도 배점 설정",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "student-contribution.list",
     "label": "기여도 목록",
     "mode": "navigate",
     "target": {
      "page": "workspace-student-contribution",
      "facet": "list"
     },
     "draft": {
      "title": "기여도 목록",
      "body": "원생별 기여도와 최근 변화를 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "student-contribution.refreshContribution"
     ]
    },
    {
     "id": "student-contribution.referral",
     "label": "소개자 연결",
     "mode": "preview",
     "draft": {
      "title": "소개 연결 미리보기",
      "body": "지난 소개 기록을 원생에게 잇는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "referrer",
       "label": "소개한 원생",
       "type": "student",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "student-contribution.searchReviewedReferrers"
     ]
    },
    {
     "id": "student-contribution.summary",
     "label": "기록 요약 보기",
     "mode": "preview",
     "draft": {
      "title": "원생 기록 요약",
      "body": "최근 기록을 모아 봅니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      }
     ],
     "result": {
      "label": "기록 모음",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "student-contribution.generateStudentRecordSummary"
     ]
    },
    {
     "id": "student-contribution.settings",
     "label": "배점 설정",
     "mode": "navigate",
     "target": {
      "page": "workspace-student-contribution",
      "facet": "settings"
     },
     "draft": {
      "title": "배점 설정",
      "body": "기여도 배점 설정을 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "student-contribution.saveContributionSettings"
     ]
    }
   ],
   "relations": [
    "student-contribution"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 5,
    "operations": 4,
    "operationIds": [
     "student-contribution.refreshContribution",
     "student-contribution.searchReviewedReferrers",
     "student-contribution.generateStudentRecordSummary",
     "student-contribution.saveContributionSettings"
    ]
   }
  },
  {
   "id": "exams",
   "label": "성적관리",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-exams",
   "summary": "학기별 시험 성적을 입력 격자와 확인 뷰로 봅니다.",
   "viewKind": "sheet",
   "facets": [
    {
     "id": "unified",
     "label": "통합 성적관리",
     "kind": "tab"
    },
    {
     "id": "input",
     "label": "성적 입력",
     "kind": "face"
    },
    {
     "id": "view",
     "label": "성적 확인",
     "kind": "face"
    },
    {
     "id": "jj",
     "label": "JJ실 시험 결과",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "exams.score",
     "label": "점수 입력 미리보기",
     "mode": "preview",
     "draft": {
      "title": "점수 입력 미리보기",
      "body": "격자에 들어갈 점수를 확인합니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "exam",
       "label": "시험",
       "type": "text",
       "required": true
      },
      {
       "id": "score",
       "label": "점수",
       "type": "number",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "exams.saveGradeScores"
     ]
    },
    {
     "id": "exams.excel",
     "label": "엑셀 성적 반영 요청",
     "mode": "request",
     "draft": {
      "title": "성적 엑셀 반영",
      "body": "서식에 맞춘 성적 엑셀을 반영해 주세요."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "exam",
       "label": "시험",
       "type": "text",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "exams.importGradesExcel"
     ]
    },
    {
     "id": "exams.ijw",
     "label": "인재원 학생 연결 요청",
     "mode": "request",
     "draft": {
      "title": "인재원 학생 연결",
      "body": "원생과 인재원 학습 계정을 연결해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "exams.linkIjwStudent"
     ]
    },
    {
     "id": "exams.learning",
     "label": "학습·성과 보기",
     "mode": "navigate",
     "target": {
      "page": "learning"
     },
     "draft": {
      "title": "학습·성과 보기",
      "body": "학습·성과 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    }
   ],
   "relations": [
    "exams"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 6,
    "operations": 3,
    "operationIds": [
     "exams.saveGradeScores",
     "exams.importGradesExcel",
     "exams.linkIjwStudent"
    ]
   }
  },
  {
   "id": "consultations",
   "label": "원생상담",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-consultations",
   "summary": "재원생 상담 기록과 후속조치를 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "list",
     "label": "원생상담",
     "kind": "tab"
    },
    {
     "id": "stats",
     "label": "상담 통계",
     "kind": "face"
    },
    {
     "id": "new",
     "label": "새 원생상담",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "consultations.write",
     "label": "상담 기록 미리보기",
     "mode": "preview",
     "draft": {
      "title": "상담 기록 미리보기",
      "body": "상담 기록과 후속조치 기한을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "category",
       "label": "상담 분류",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "general",
         "label": "일반"
        },
        {
         "value": "academic",
         "label": "학습"
        },
        {
         "value": "emotional",
         "label": "정서"
        },
        {
         "value": "career",
         "label": "진로"
        },
        {
         "value": "social",
         "label": "교우"
        },
        {
         "value": "other",
         "label": "기타"
        }
       ],
       "optionSource": "consultationCategory"
      },
      {
       "id": "audience",
       "label": "상담 대상",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "parent",
         "label": "학부모"
        },
        {
         "value": "student",
         "label": "학생"
        },
        {
         "value": "both",
         "label": "학부모+학생"
        }
       ],
       "optionSource": "consultationAudience"
      },
      {
       "id": "summary",
       "label": "상담 내용",
       "type": "textarea",
       "required": true
      },
      {
       "id": "followup",
       "label": "후속조치 기한",
       "type": "date"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "consultations.createStudentConsultation"
     ]
    },
    {
     "id": "consultations.followup",
     "label": "후속조치 요청",
     "mode": "request",
     "draft": {
      "title": "상담 후속조치",
      "body": "아래 원생의 상담 후속조치를 진행하고 결과를 남겨 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "due",
       "label": "기한",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "후속조치 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "consultations.toggleConsultationFollowUp"
     ]
    },
    {
     "id": "consultations.audio",
     "label": "녹음으로 상담 시작",
     "mode": "preview",
     "draft": {
      "title": "녹음 상담",
      "body": "녹음을 올리면 전사·분석으로 이어지는 흐름을 봅니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "file",
       "label": "녹음 파일 이름",
       "type": "text"
      }
     ],
     "result": {
      "label": "흐름 안내",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "consultations.startStudentConsultationFromAudio"
     ]
    }
   ],
   "relations": [
    "consultations"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 5,
    "operations": 3,
    "operationIds": [
     "consultations.createStudentConsultation",
     "consultations.toggleConsultationFollowUp",
     "consultations.startStudentConsultationFromAudio"
    ]
   }
  },
  {
   "id": "enrollment",
   "label": "신규 콜&상담",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-enrollment",
   "summary": "신규 콜&상담을 접수부터 등록까지 단계로 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "pending",
     "label": "대기",
     "kind": "stage"
    },
    {
     "id": "scheduled",
     "label": "예약",
     "kind": "stage"
    },
    {
     "id": "consulted",
     "label": "상담완료",
     "kind": "stage"
    },
    {
     "id": "enrolled",
     "label": "재원생 등록 완료",
     "kind": "stage"
    },
    {
     "id": "declined",
     "label": "거절",
     "kind": "stage"
    },
    {
     "id": "no_show",
     "label": "노쇼",
     "kind": "stage"
    },
    {
     "id": "intake",
     "label": "QR 상담 접수",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "enrollment.legacy",
     "label": "신규 상담 보기",
     "mode": "navigate",
     "target": {
      "page": "admissions"
     },
     "draft": {
      "title": "신규 상담 보기",
      "body": "신규 콜&상담 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "enrollment.write",
     "label": "상담 접수 미리보기",
     "mode": "preview",
     "draft": {
      "title": "신규 상담 접수",
      "body": "접수될 상담 카드를 확인합니다."
     },
     "fields": [
      {
       "id": "name",
       "label": "원생 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "grade",
       "label": "학년",
       "type": "text"
      },
      {
       "id": "path",
       "label": "상담 경로",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "지인 소개",
         "label": "지인 소개"
        },
        {
         "value": "인터넷 검색",
         "label": "인터넷 검색"
        },
        {
         "value": "블로그/카페",
         "label": "블로그/카페"
        },
        {
         "value": "간판/현수막",
         "label": "간판/현수막"
        },
        {
         "value": "전단지",
         "label": "전단지"
        },
        {
         "value": "설명회",
         "label": "설명회"
        },
        {
         "value": "재원생 추천",
         "label": "재원생 추천"
        },
        {
         "value": "기타",
         "label": "기타"
        }
       ],
       "optionSource": "consultationPath"
      },
      {
       "id": "consulted",
       "label": "상담일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "enrollment.createEnrollmentConsultation"
     ]
    },
    {
     "id": "enrollment.outcome",
     "label": "결과 지정",
     "mode": "preview",
     "draft": {
      "title": "상담 결과 미리보기",
      "body": "칸반 단계가 바뀌는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "name",
       "label": "원생 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "outcome",
       "label": "결과",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "pending",
         "label": "대기"
        },
        {
         "value": "scheduled",
         "label": "예약"
        },
        {
         "value": "consulted",
         "label": "상담완료"
        },
        {
         "value": "ai_done",
         "label": "AI 완료"
        },
        {
         "value": "enrolled",
         "label": "재원생 등록 완료"
        },
        {
         "value": "declined",
         "label": "거절"
        },
        {
         "value": "no_show",
         "label": "노쇼"
        }
       ],
       "optionSource": "enrollmentOutcome"
      },
      {
       "id": "next",
       "label": "다음 상담일",
       "type": "date"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "enrollment.setEnrollmentOutcome"
     ]
    },
    {
     "id": "enrollment.convert",
     "label": "원생 전환·반 배정 요청",
     "mode": "request",
     "draft": {
      "title": "원생 전환",
      "body": "아래 상담 학생을 원생으로 등록하고 반에 배정해 주세요."
     },
     "fields": [
      {
       "id": "name",
       "label": "원생 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "enrollment.convertConsultationToStudent"
     ]
    },
    {
     "id": "enrollment.brief",
     "label": "상담 준비 보기",
     "mode": "preview",
     "draft": {
      "title": "상담 준비",
      "body": "이전 상담과 같은 사람의 기록을 모아 봅니다."
     },
     "fields": [
      {
       "id": "name",
       "label": "원생 이름",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "기록 모음",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "enrollment.regenerateConsultationAnalysis"
     ]
    },
    {
     "id": "enrollment.qr",
     "label": "QR 상담 접수",
     "mode": "navigate",
     "target": {
      "page": "workspace-enrollment",
      "facet": "intake"
     },
     "draft": {
      "title": "QR 상담 접수",
      "body": "학부모가 QR로 상담을 신청하는 공개 화면을 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "enrollment.createIntakeToken"
     ]
    },
    {
     "id": "enrollment.makeedu",
     "label": "메이크에듀 전송 요청",
     "mode": "request",
     "draft": {
      "title": "메이크에듀 상담 전송",
      "body": "QR 접수 상담을 메이크에듀로 보내 주세요(연동 PC 필요)."
     },
     "fields": [
      {
       "id": "name",
       "label": "원생 이름",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "enrollment.enqueueConsultationPush"
     ]
    }
   ],
   "relations": [
    "enrollment"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P0",
    "sourceRoutes": 7,
    "operations": 6,
    "operationIds": [
     "enrollment.createEnrollmentConsultation",
     "enrollment.setEnrollmentOutcome",
     "enrollment.convertConsultationToStudent",
     "enrollment.regenerateConsultationAnalysis",
     "enrollment.createIntakeToken",
     "enrollment.enqueueConsultationPush"
    ]
   }
  },
  {
   "id": "retention",
   "label": "이탈 방어",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-retention",
   "summary": "이탈 위험 원생과 재등록 캠페인을 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "brief",
     "label": "브리핑",
     "kind": "tab"
    },
    {
     "id": "board",
     "label": "리텐션 보드",
     "kind": "tab"
    },
    {
     "id": "messages",
     "label": "학부모 메시지",
     "kind": "tab"
    },
    {
     "id": "campaign",
     "label": "재등록 캠페인",
     "kind": "tab"
    }
   ],
   "actions": [
    {
     "id": "retention.campaign",
     "label": "캠페인 대상 추가",
     "mode": "preview",
     "draft": {
      "title": "재등록 캠페인 미리보기",
      "body": "원생을 재등록 캠페인 대상에 넣는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "retention.campaignAdd"
     ]
    },
    {
     "id": "retention.contact",
     "label": "보호자 연락 요청",
     "mode": "request",
     "draft": {
      "title": "이탈 방어 연락",
      "body": "아래 원생의 보호자에게 연락하고 결과를 남겨 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "연락할 내용",
       "type": "textarea",
       "required": true
      },
      {
       "id": "due",
       "label": "기한",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "retention.logRetentionAction"
     ]
    },
    {
     "id": "retention.board",
     "label": "리텐션 보드",
     "mode": "navigate",
     "target": {
      "page": "workspace-retention",
      "facet": "board"
     },
     "draft": {
      "title": "리텐션 보드",
      "body": "이탈 위험이 있는 재원생을 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    }
   ],
   "relations": [
    "retention"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 4,
    "operations": 2,
    "operationIds": [
     "retention.campaignAdd",
     "retention.logRetentionAction"
    ]
   }
  },
  {
   "id": "newcomers",
   "label": "신규생 관리",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-newcomers",
   "summary": "신입 등록 후 90일 체크리스트를 단계로 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "pre_call",
     "label": "수업 전 사전 콜",
     "kind": "stage"
    },
    {
     "id": "first_class_guide",
     "label": "첫 수업 안내",
     "kind": "stage"
    },
    {
     "id": "ojt",
     "label": "OJT",
     "kind": "stage"
    },
    {
     "id": "after_first_call",
     "label": "첫 수업 후 콜",
     "kind": "stage"
    },
    {
     "id": "month1_call",
     "label": "1개월 콜",
     "kind": "stage"
    },
    {
     "id": "stats",
     "label": "신규생 기록",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "newcomers.check",
     "label": "체크 항목 완료",
     "mode": "preview",
     "draft": {
      "title": "신입 체크 미리보기",
      "body": "체크리스트 항목을 완료로 표시했을 때의 진행을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "item",
       "label": "항목",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "pre_call",
         "label": "수업 전 사전 콜"
        },
        {
         "value": "first_class_guide",
         "label": "첫 수업 교재·과제·교실 안내"
        },
        {
         "value": "ojt",
         "label": "신입생 OJT 실시"
        },
        {
         "value": "after_first_call",
         "label": "첫 수업 후 상담 콜"
        },
        {
         "value": "month1_call",
         "label": "1개월 만족도 콜"
        },
        {
         "value": "month2_call",
         "label": "2개월 만족도 콜(필요시)"
        },
        {
         "value": "month3_call",
         "label": "3개월 만족도 콜"
        }
       ],
       "optionSource": "onboardingItem"
      },
      {
       "id": "done",
       "label": "완료일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "newcomers.setOnboardingCheck"
     ]
    },
    {
     "id": "newcomers.call",
     "label": "신입 콜 요청",
     "mode": "request",
     "draft": {
      "title": "신입생 콜",
      "body": "아래 신입생에게 체크리스트 항목에 맞춰 연락해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "item",
       "label": "항목",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "pre_call",
         "label": "수업 전 사전 콜"
        },
        {
         "value": "first_class_guide",
         "label": "첫 수업 교재·과제·교실 안내"
        },
        {
         "value": "ojt",
         "label": "신입생 OJT 실시"
        },
        {
         "value": "after_first_call",
         "label": "첫 수업 후 상담 콜"
        },
        {
         "value": "month1_call",
         "label": "1개월 만족도 콜"
        },
        {
         "value": "month2_call",
         "label": "2개월 만족도 콜(필요시)"
        },
        {
         "value": "month3_call",
         "label": "3개월 만족도 콜"
        }
       ],
       "optionSource": "onboardingItem"
      },
      {
       "id": "due",
       "label": "기한",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "newcomers.setOnboardingCheck"
     ]
    }
   ],
   "relations": [
    "newcomers"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 2,
    "operations": 1,
    "operationIds": [
     "newcomers.setOnboardingCheck"
    ]
   }
  },
  {
   "id": "withdrawals",
   "label": "퇴원관리",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-withdrawals",
   "summary": "퇴원·수강종료를 사유와 추이로 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "list",
     "label": "퇴원관리",
     "kind": "tab"
    },
    {
     "id": "detail",
     "label": "퇴원 상세",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "withdrawals.reason",
     "label": "퇴원 사유 정리",
     "mode": "preview",
     "draft": {
      "title": "퇴원 사유 미리보기",
      "body": "퇴원 사유 분류를 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "reason",
       "label": "대분류",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "dissatisfaction",
         "label": "수업·강사"
        },
        {
         "value": "grades",
         "label": "성적"
        },
        {
         "value": "motivation",
         "label": "학생 상태"
        },
        {
         "value": "method",
         "label": "공부 방법 변경"
        },
        {
         "value": "competitor",
         "label": "타 학원으로 이동"
        },
        {
         "value": "schedule",
         "label": "시간/일정"
        },
        {
         "value": "financial",
         "label": "경제적 이유"
        },
        {
         "value": "career",
         "label": "진로·진학"
        },
        {
         "value": "peers",
         "label": "가족·친구"
        },
        {
         "value": "illness",
         "label": "질병"
        },
        {
         "value": "advised",
         "label": "권고퇴원"
        },
        {
         "value": "relocation",
         "label": "이사"
        },
        {
         "value": "graduated",
         "label": "졸업"
        },
        {
         "value": "other",
         "label": "기타"
        }
       ],
       "optionSource": "withdrawalReason"
      },
      {
       "id": "memo",
       "label": "세부 메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "withdrawals.updateWithdrawalReason"
     ]
    },
    {
     "id": "withdrawals.reactivate",
     "label": "재원 복귀 요청",
     "mode": "request",
     "draft": {
      "title": "재원 복귀",
      "body": "아래 원생을 재원으로 되돌려 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "effective",
       "label": "복귀일",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "withdrawals.reactivateStudent"
     ]
    }
   ],
   "relations": [
    "withdrawals"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 2,
    "operations": 2,
    "operationIds": [
     "withdrawals.reactivateStudent",
     "withdrawals.updateWithdrawalReason"
    ]
   }
  },
  {
   "id": "withdrawal-reports",
   "label": "퇴원보고서",
   "group": "원생",
   "groupId": "student",
   "page": "workspace-withdrawal-reports",
   "summary": "퇴원보고서를 작성 요청부터 승인·처리까지 단계로 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "list",
     "label": "퇴원보고서",
     "kind": "tab"
    },
    {
     "id": "detail",
     "label": "보고서",
     "kind": "face"
    },
    {
     "id": "archive",
     "label": "스프레드시트 기록",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "withdrawal-reports.request",
     "label": "퇴원보고서 작성 요청",
     "mode": "request",
     "draft": {
      "title": "퇴원보고서 작성",
      "body": "담임 선생님은 아래 원생의 퇴원보고서를 작성해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "요청 메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "withdrawal-reports.requestWithdrawalReport"
     ]
    },
    {
     "id": "withdrawal-reports.decide",
     "label": "승인·반려 미리보기",
     "mode": "preview",
     "draft": {
      "title": "퇴원보고서 결정 미리보기",
      "body": "보고서 단계가 바뀌는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "decision",
       "label": "결정",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "approve",
         "label": "승인"
        },
        {
         "value": "reject",
         "label": "반려"
        }
       ],
       "optionSource": "inline-verified"
      },
      {
       "id": "memo",
       "label": "의견",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "withdrawal-reports.changeWithdrawalReport"
     ]
    },
    {
     "id": "withdrawal-reports.archive",
     "label": "옛 기록 연결",
     "mode": "preview",
     "draft": {
      "title": "옛 퇴원 기록 연결",
      "body": "스프레드시트 시절 퇴원 기록을 원생에게 잇는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "withdrawal-reports.mapArchive"
     ]
    }
   ],
   "relations": [
    "withdrawal-reports"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 4,
    "operations": 3,
    "operationIds": [
     "withdrawal-reports.requestWithdrawalReport",
     "withdrawal-reports.changeWithdrawalReport",
     "withdrawal-reports.mapArchive"
    ]
   }
  },
  {
   "id": "staff",
   "label": "직원관리",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-staff",
   "summary": "직원 명부·계약·이력서·휴가·연차를 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "list",
     "label": "직원 목록",
     "kind": "tab"
    },
    {
     "id": "detail",
     "label": "직원 상세",
     "kind": "face"
    },
    {
     "id": "leaves",
     "label": "휴가 관리",
     "kind": "face"
    },
    {
     "id": "annual",
     "label": "연차 관리",
     "kind": "face"
    },
    {
     "id": "payroll",
     "label": "월별 급여",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "staff.legacy",
     "label": "직원 화면 열기",
     "mode": "navigate",
     "target": {
      "page": "staff"
     },
     "draft": {
      "title": "직원 화면 열기",
      "body": "직원 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "staff.register",
     "label": "직원 등록 요청",
     "mode": "request",
     "draft": {
      "title": "직원 등록",
      "body": "아래 직원의 계정과 이력서를 등록해 주세요."
     },
     "fields": [
      {
       "id": "name",
       "label": "이름",
       "type": "text",
       "required": true
      },
      {
       "id": "title",
       "label": "직급",
       "type": "text"
      },
      {
       "id": "hire",
       "label": "입사일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "staff.createStaff",
      "staff.changeStaffEmail",
      "staff.saveStaffResume",
      "staff.ensureStaffIntakeToken"
     ]
    },
    {
     "id": "staff.leave",
     "label": "휴가 신청 미리보기",
     "mode": "preview",
     "draft": {
      "title": "휴가 신청 미리보기",
      "body": "휴가 기간과 유형을 확인합니다."
     },
     "fields": [
      {
       "id": "staff",
       "label": "휴가 직원",
       "type": "staff",
       "required": true
      },
      {
       "id": "type",
       "label": "휴가 유형",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "연차",
         "label": "연차"
        },
        {
         "value": "반차",
         "label": "반차"
        },
        {
         "value": "병가",
         "label": "병가"
        },
        {
         "value": "경조사",
         "label": "경조사"
        },
        {
         "value": "기타",
         "label": "기타"
        }
       ],
       "optionSource": "leaveType"
      },
      {
       "id": "from",
       "label": "시작일",
       "type": "date",
       "required": true
      },
      {
       "id": "to",
       "label": "종료일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "staff.requestLeave",
      "staff.addLeaveAdjustment"
     ]
    },
    {
     "id": "staff.contract",
     "label": "계약 갱신 요청",
     "mode": "request",
     "draft": {
      "title": "계약 갱신",
      "body": "아래 직원의 계약 갱신을 준비해 주세요."
     },
     "fields": [
      {
       "id": "staff",
       "label": "대상 직원",
       "type": "staff",
       "required": true
      },
      {
       "id": "end",
       "label": "계약 만료일",
       "type": "date",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "staff.updateStaffContract"
     ]
    },
    {
     "id": "staff.task",
     "label": "직원 업무 요청",
     "mode": "request",
     "draft": {
      "title": "직원 업무",
      "body": "아래 업무를 진행하고 완료되면 알려 주세요."
     },
     "fields": [
      {
       "id": "staff",
       "label": "담당 직원",
       "type": "staff",
       "required": true
      },
      {
       "id": "title",
       "label": "업무",
       "type": "text",
       "required": true
      },
      {
       "id": "due",
       "label": "기한",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "staff.createStaffTask"
     ]
    },
    {
     "id": "staff.schedule",
     "label": "근무 설정 변경 요청",
     "mode": "request",
     "draft": {
      "title": "근무 설정 변경",
      "body": "아래 직원의 주간 근무 일정을 바꿔 주세요."
     },
     "fields": [
      {
       "id": "staff",
       "label": "대상 직원",
       "type": "staff",
       "required": true
      },
      {
       "id": "days",
       "label": "근무 요일",
       "type": "multiselect",
       "required": true,
       "options": [
        {
         "value": "mon",
         "label": "월"
        },
        {
         "value": "tue",
         "label": "화"
        },
        {
         "value": "wed",
         "label": "수"
        },
        {
         "value": "thu",
         "label": "목"
        },
        {
         "value": "fri",
         "label": "금"
        },
        {
         "value": "sat",
         "label": "토"
        },
        {
         "value": "sun",
         "label": "일"
        }
       ],
       "optionSource": "weekday"
      },
      {
       "id": "time",
       "label": "근무 시간",
       "type": "text"
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "staff.work-schedule"
     ]
    }
   ],
   "relations": [
    "staff"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 13,
    "operations": 8,
    "operationIds": [
     "staff.createStaff",
     "staff.changeStaffEmail",
     "staff.updateStaffContract",
     "staff.saveStaffResume",
     "staff.ensureStaffIntakeToken",
     "staff.requestLeave",
     "staff.addLeaveAdjustment",
     "staff.createStaffTask"
    ]
   }
  },
  {
   "id": "payroll",
   "label": "급여·명세서",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-payroll",
   "summary": "급여명세서와 강사 정산을 봅니다.",
   "viewKind": "report",
   "facets": [
    {
     "id": "payslip",
     "label": "급여명세서",
     "kind": "tab"
    },
    {
     "id": "teacher",
     "label": "강사 정산",
     "kind": "face"
    },
    {
     "id": "month",
     "label": "월별 급여",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "payroll.payslip",
     "label": "명세서 미리보기",
     "mode": "preview",
     "draft": {
      "title": "급여명세서 미리보기",
      "body": "출석부 실급여 합계 기준 명세서 구성을 확인합니다."
     },
     "fields": [
      {
       "id": "staff",
       "label": "선생님",
       "type": "staff",
       "required": true
      },
      {
       "id": "month",
       "label": "월",
       "type": "month",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "payroll.issuePayslip",
      "payroll.autoComputePayroll"
     ]
    },
    {
     "id": "payroll.class-salary",
     "label": "반별 배분율",
     "mode": "preview",
     "draft": {
      "title": "반별 급여 배분 미리보기",
      "body": "반의 급여 배분율(0~100%)을 확인합니다."
     },
     "fields": [
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "rate",
       "label": "배분율(%)",
       "type": "number",
       "required": true,
       "min": 0,
       "max": 100
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "payroll.saveClassSalary"
     ]
    }
   ],
   "relations": [
    "payroll"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 1,
    "operations": 3,
    "operationIds": [
     "payroll.issuePayslip",
     "payroll.autoComputePayroll",
     "payroll.saveClassSalary"
    ]
   }
  },
  {
   "id": "billing",
   "label": "수납관리",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-billing",
   "summary": "청구·수납과 교재·지출·회차 확정·환불을 봅니다.",
   "viewKind": "report",
   "facets": [
    {
     "id": "billing",
     "label": "수납",
     "kind": "tab"
    },
    {
     "id": "textbooks",
     "label": "교재",
     "kind": "tab"
    },
    {
     "id": "expenses",
     "label": "지출",
     "kind": "tab"
    },
    {
     "id": "calculator",
     "label": "수강료 계산기",
     "kind": "tab"
    },
    {
     "id": "sessions",
     "label": "회차 확정",
     "kind": "tab"
    },
    {
     "id": "refunds",
     "label": "환불 요청서",
     "kind": "tab"
    },
    {
     "id": "payroll",
     "label": "강사 정산",
     "kind": "tab"
    },
    {
     "id": "stats",
     "label": "수납 통계",
     "kind": "face"
    },
    {
     "id": "prices",
     "label": "수강료 단가",
     "kind": "filter"
    },
    {
     "id": "catalog",
     "label": "교재 단가표",
     "kind": "filter"
    },
    {
     "id": "holidays",
     "label": "공휴일",
     "kind": "filter"
    },
    {
     "id": "quotes",
     "label": "저장된 청구서",
     "kind": "filter"
    }
   ],
   "actions": [
    {
     "id": "billing.legacy",
     "label": "수납 화면 열기",
     "mode": "navigate",
     "target": {
      "page": "finance"
     },
     "draft": {
      "title": "수납 화면 열기",
      "body": "수납·재무 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "billing.remind",
     "label": "수납 안내 요청",
     "mode": "request",
     "draft": {
      "title": "수납 확인·안내",
      "body": "아래 원생의 남은 수납을 확인하고, 필요하면 보호자에게 안내한 뒤 결과를 남겨 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "month",
       "label": "월",
       "type": "month",
       "required": true
      },
      {
       "id": "amount",
       "label": "남은 금액",
       "type": "money"
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "billing.createInvoice"
     ]
    },
    {
     "id": "billing.quote",
     "label": "수강료 계산기",
     "mode": "preview",
     "draft": {
      "title": "수강료 견적",
      "body": "회차 × 단가 − 할인으로 견적을 계산합니다."
     },
     "fields": [
      {
       "id": "name",
       "label": "원생 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "sessions",
       "label": "회차",
       "type": "number",
       "required": true
      },
      {
       "id": "unit",
       "label": "회당 단가",
       "type": "money",
       "required": true
      },
      {
       "id": "discount",
       "label": "할인",
       "type": "money"
      }
     ],
     "result": {
      "label": "계산 결과 미리보기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "billing.saveTuitionQuote",
      "billing.createTuitionItem"
     ]
    },
    {
     "id": "billing.expense",
     "label": "지출 결의 미리보기",
     "mode": "preview",
     "draft": {
      "title": "지출 결의 미리보기",
      "body": "지출 결의 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "category",
       "label": "분류",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "인건비",
         "label": "인건비"
        },
        {
         "value": "운영비",
         "label": "운영비"
        },
        {
         "value": "매입",
         "label": "매입"
        },
        {
         "value": "마케팅",
         "label": "마케팅"
        },
        {
         "value": "기타",
         "label": "기타"
        }
       ],
       "optionSource": "expenseCategory"
      },
      {
       "id": "title",
       "label": "내용",
       "type": "text",
       "required": true
      },
      {
       "id": "amount",
       "label": "금액",
       "type": "money",
       "required": true
      },
      {
       "id": "spent",
       "label": "지출일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "billing.createExpense"
     ]
    },
    {
     "id": "billing.textbook",
     "label": "교재 주문 미리보기",
     "mode": "preview",
     "draft": {
      "title": "교재 주문 미리보기",
      "body": "교재 주문 줄을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "book",
       "label": "교재",
       "type": "text",
       "required": true
      },
      {
       "id": "price",
       "label": "가격",
       "type": "money"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "billing.createTextbookOrder"
     ]
    },
    {
     "id": "billing.session",
     "label": "회차 확정 미리보기",
     "mode": "preview",
     "draft": {
      "title": "회차 확정 미리보기",
      "body": "확정 시수 × 단가를 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "class",
       "label": "반",
       "type": "class",
       "required": true
      },
      {
       "id": "month",
       "label": "월",
       "type": "month",
       "required": true
      },
      {
       "id": "sessions",
       "label": "확정 시수",
       "type": "number",
       "required": true,
       "min": 0,
       "max": 99
      },
      {
       "id": "unit",
       "label": "회당 단가",
       "type": "money"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "billing.confirmSessionTerm",
      "billing.saveSeatShareAdjust"
     ]
    },
    {
     "id": "billing.refund",
     "label": "환불 요청서 미리보기",
     "mode": "preview",
     "draft": {
      "title": "환불 요청서 미리보기",
      "body": "환불 요청서 내용을 확인합니다. 계좌 정보는 적지 않습니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "amount",
       "label": "환불 금액",
       "type": "money",
       "required": true
      },
      {
       "id": "memo",
       "label": "사유",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "billing.saveRefundRequest"
     ]
    }
   ],
   "relations": [
    "billing"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P0",
    "sourceRoutes": 5,
    "operations": 8,
    "operationIds": [
     "billing.createInvoice",
     "billing.createTextbookOrder",
     "billing.createExpense",
     "billing.createTuitionItem",
     "billing.saveTuitionQuote",
     "billing.confirmSessionTerm",
     "billing.saveRefundRequest",
     "billing.saveSeatShareAdjust"
    ]
   }
  },
  {
   "id": "textbook-requests",
   "label": "교재 요청",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-textbook-requests",
   "summary": "선생님이 요청한 교재가 주문·전달·납부되는 흐름을 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "list",
     "label": "교재 요청",
     "kind": "tab"
    },
    {
     "id": "print",
     "label": "교재 요청서",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "textbook-requests.legacy",
     "label": "교재 흐름 보기",
     "mode": "navigate",
     "target": {
      "page": "resources"
     },
     "draft": {
      "title": "교재 흐름 보기",
      "body": "교재·재고·서식 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "textbook-requests.order",
     "label": "교재 주문 확인 요청",
     "mode": "request",
     "draft": {
      "title": "교재 주문·전달 확인",
      "body": "요청된 교재의 주문과 전달 상황을 확인해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "book",
       "label": "교재",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "textbook-requests.requestTextbook",
      "textbook-requests.registerTextbookAttachment"
     ]
    },
    {
     "id": "textbook-requests.notice",
     "label": "교재 안내 공지 미리보기",
     "mode": "preview",
     "draft": {
      "title": "교재 안내 공지",
      "body": "학부모에게 보낼 교재 안내 문구를 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "body",
       "label": "안내 문구",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "textbook-requests.prepareTextbookNotice"
     ]
    }
   ],
   "relations": [
    "textbook-requests"
   ],
   "meta": {
    "ownerScope": "owner-linked",
    "priority": "P1",
    "sourceRoutes": 2,
    "operations": 3,
    "operationIds": [
     "textbook-requests.requestTextbook",
     "textbook-requests.registerTextbookAttachment",
     "textbook-requests.prepareTextbookNotice"
    ]
   }
  },
  {
   "id": "expense-requests",
   "label": "지출결의서",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-expense-requests",
   "summary": "선생님이 제출한 지출결의서를 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "list",
     "label": "지출결의서",
     "kind": "tab"
    },
    {
     "id": "detail",
     "label": "지출결의서 상세",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "expense-requests.review",
     "label": "지출결의서 확인 요청",
     "mode": "request",
     "draft": {
      "title": "지출결의서 확인",
      "body": "제출된 지출결의서를 검토해 결재로 넘기거나 보완을 요청해 주세요."
     },
     "fields": [
      {
       "id": "staff",
       "label": "작성 선생님",
       "type": "staff",
       "required": true
      },
      {
       "id": "amount",
       "label": "금액",
       "type": "money"
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "expense-requests.deleteExpense"
     ]
    }
   ],
   "relations": [
    "expense-requests"
   ],
   "meta": {
    "ownerScope": "owner-linked",
    "priority": "P2",
    "sourceRoutes": 2,
    "operations": 1,
    "operationIds": [
     "expense-requests.deleteExpense"
    ]
   }
  },
  {
   "id": "shuttle",
   "label": "셔틀",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-shuttle",
   "summary": "노선 편성과 오늘 등하원·운행 현황을 봅니다.",
   "viewKind": "timeline",
   "facets": [
    {
     "id": "route",
     "label": "노선 편성",
     "kind": "tab"
    },
    {
     "id": "week",
     "label": "주간 시간표",
     "kind": "tab"
    },
    {
     "id": "today",
     "label": "오늘 등하원",
     "kind": "tab"
    },
    {
     "id": "parent-rides",
     "label": "학부모 등하원",
     "kind": "tab"
    },
    {
     "id": "live",
     "label": "운행 현황",
     "kind": "tab"
    },
    {
     "id": "track",
     "label": "실시간 위치",
     "kind": "tab"
    },
    {
     "id": "parents",
     "label": "학부모 관리 현황",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "shuttle.legacy",
     "label": "셔틀 화면 열기",
     "mode": "navigate",
     "target": {
      "page": "shuttle"
     },
     "draft": {
      "title": "셔틀 화면 열기",
      "body": "차량·안전 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "shuttle.run",
     "label": "회차 편성 미리보기",
     "mode": "preview",
     "draft": {
      "title": "회차 편성 미리보기",
      "body": "차량·시즌·방향별 회차를 확인합니다."
     },
     "fields": [
      {
       "id": "season",
       "label": "시즌",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "term",
         "label": "학기중"
        },
        {
         "value": "vacation",
         "label": "방학중"
        }
       ],
       "optionSource": "shuttleSeason"
      },
      {
       "id": "direction",
       "label": "방향",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "in",
         "label": "등원"
        },
        {
         "value": "out",
         "label": "하원"
        }
       ],
       "optionSource": "shuttleDirection"
      },
      {
       "id": "vehicle",
       "label": "차량",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "shuttle.createRun",
      "shuttle.createStop",
      "shuttle.saveVehicle"
     ]
    },
    {
     "id": "shuttle.rider",
     "label": "학생 배정",
     "mode": "preview",
     "draft": {
      "title": "셔틀 배정 미리보기",
      "body": "정류장에 학생을 요일별로 배정한 모습을 봅니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "direction",
       "label": "방향",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "in",
         "label": "등원"
        },
        {
         "value": "out",
         "label": "하원"
        }
       ],
       "optionSource": "shuttleDirection"
      },
      {
       "id": "weekdays",
       "label": "요일",
       "type": "multiselect",
       "required": true,
       "options": [
        {
         "value": "mon",
         "label": "월"
        },
        {
         "value": "tue",
         "label": "화"
        },
        {
         "value": "wed",
         "label": "수"
        },
        {
         "value": "thu",
         "label": "목"
        },
        {
         "value": "fri",
         "label": "금"
        },
        {
         "value": "sat",
         "label": "토"
        },
        {
         "value": "sun",
         "label": "일"
        }
       ],
       "optionSource": "weekday"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "shuttle.assignRider"
     ]
    },
    {
     "id": "shuttle.boarding",
     "label": "탑승 기록 미리보기",
     "mode": "preview",
     "draft": {
      "title": "탑승 기록 미리보기",
      "body": "운행 시작 뒤 탑승 기록을 남기는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "status",
       "label": "탑승",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "boarded",
         "label": "탑승"
        },
        {
         "value": "missed",
         "label": "미탑승"
        },
        {
         "value": "extra",
         "label": "추가 탑승"
        }
       ],
       "optionSource": "boardingStatus"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "shuttle.recordBoarding",
      "shuttle.staffChangeRideStop"
     ]
    },
    {
     "id": "shuttle.parent-account",
     "label": "학부모 계정 발급 요청",
     "mode": "request",
     "draft": {
      "title": "학부모 계정 발급",
      "body": "아래 원생의 학부모 계정을 발급해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "shuttle.createParentAccount"
     ]
    }
   ],
   "relations": [
    "shuttle"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 8,
    "operations": 7,
    "operationIds": [
     "shuttle.createRun",
     "shuttle.createStop",
     "shuttle.assignRider",
     "shuttle.recordBoarding",
     "shuttle.staffChangeRideStop",
     "shuttle.saveVehicle",
     "shuttle.createParentAccount"
    ]
   }
  },
  {
   "id": "inventory",
   "label": "재고관리",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-inventory",
   "summary": "전자기기 자산·대여·실사·소모품·업체를 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "assets",
     "label": "자산",
     "kind": "tab"
    },
    {
     "id": "loans",
     "label": "대여",
     "kind": "tab"
    },
    {
     "id": "audits",
     "label": "실사",
     "kind": "tab"
    },
    {
     "id": "supplies",
     "label": "소모품",
     "kind": "tab"
    },
    {
     "id": "vendors",
     "label": "업체리스트",
     "kind": "tab"
    },
    {
     "id": "qr",
     "label": "자산 QR 라벨",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "inventory.asset",
     "label": "자산 등록 미리보기",
     "mode": "preview",
     "draft": {
      "title": "자산 등록 미리보기",
      "body": "자산 대장 줄을 확인합니다(대여중은 대여 시작으로만)."
     },
     "fields": [
      {
       "id": "code",
       "label": "자산ID",
       "type": "text",
       "required": true
      },
      {
       "id": "model",
       "label": "모델",
       "type": "text"
      },
      {
       "id": "status",
       "label": "상태",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "in_use",
         "label": "사용중"
        },
        {
         "value": "on_loan",
         "label": "대여중"
        },
        {
         "value": "repair",
         "label": "수리중"
        },
        {
         "value": "lost",
         "label": "분실"
        },
        {
         "value": "check",
         "label": "확인필요"
        },
        {
         "value": "unregistered",
         "label": "미등록"
        },
        {
         "value": "disposed",
         "label": "폐기"
        }
       ],
       "optionSource": "assetStatus"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "inventory.createAsset",
      "inventory.importInventoryExcel"
     ]
    },
    {
     "id": "inventory.loan",
     "label": "대여 시작",
     "mode": "preview",
     "draft": {
      "title": "대여 미리보기",
      "body": "자산 대여 기록을 확인합니다."
     },
     "fields": [
      {
       "id": "asset",
       "label": "자산ID",
       "type": "text",
       "required": true
      },
      {
       "id": "borrower",
       "label": "대여자",
       "type": "text",
       "required": true
      },
      {
       "id": "due",
       "label": "반납 예정일",
       "type": "date"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "inventory.startLoan"
     ]
    },
    {
     "id": "inventory.audit",
     "label": "실사 기록",
     "mode": "preview",
     "draft": {
      "title": "실사 미리보기",
      "body": "실사 결과를 확인합니다."
     },
     "fields": [
      {
       "id": "asset",
       "label": "자산ID",
       "type": "text",
       "required": true
      },
      {
       "id": "result",
       "label": "실사 결과",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "ok",
         "label": "확인"
        },
        {
         "value": "missing",
         "label": "미확인"
        },
        {
         "value": "hold",
         "label": "보류"
        }
       ],
       "optionSource": "auditResult"
      },
      {
       "id": "audited",
       "label": "실사일",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "inventory.recordAudit"
     ]
    },
    {
     "id": "inventory.supply",
     "label": "소모품 보충 요청",
     "mode": "request",
     "draft": {
      "title": "소모품 보충",
      "body": "아래 소모품을 보충하고 업체 연락처를 확인해 주세요."
     },
     "fields": [
      {
       "id": "item",
       "label": "품목",
       "type": "text",
       "required": true
      },
      {
       "id": "qty",
       "label": "수량",
       "type": "number"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "inventory.createSupply",
      "inventory.createVendor"
     ]
    }
   ],
   "relations": [
    "inventory"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 3,
    "operations": 6,
    "operationIds": [
     "inventory.createAsset",
     "inventory.startLoan",
     "inventory.recordAudit",
     "inventory.createSupply",
     "inventory.createVendor",
     "inventory.importInventoryExcel"
    ]
   }
  },
  {
   "id": "meetings",
   "label": "회의록",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-meetings",
   "summary": "회의록과 녹음 분석 결과를 봅니다.",
   "viewKind": "timeline",
   "facets": [
    {
     "id": "list",
     "label": "회의록",
     "kind": "tab"
    },
    {
     "id": "new",
     "label": "새 회의록",
     "kind": "face"
    },
    {
     "id": "detail",
     "label": "회의록 상세",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "meetings.text",
     "label": "회의록 작성 미리보기",
     "mode": "preview",
     "draft": {
      "title": "회의록 미리보기",
      "body": "텍스트 회의록을 확인합니다."
     },
     "fields": [
      {
       "id": "title",
       "label": "제목",
       "type": "text",
       "required": true
      },
      {
       "id": "held",
       "label": "회의일",
       "type": "date",
       "required": true
      },
      {
       "id": "content",
       "label": "메모",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "meetings.createTextMeeting",
      "meetings.updateMeetingNotepad"
     ]
    },
    {
     "id": "meetings.followup",
     "label": "결정 사항 실행 요청",
     "mode": "request",
     "draft": {
      "title": "회의 결정 사항 실행",
      "body": "회의에서 정한 아래 사항을 진행하고 결과를 알려 주세요."
     },
     "fields": [
      {
       "id": "title",
       "label": "결정 사항",
       "type": "text",
       "required": true
      },
      {
       "id": "staff",
       "label": "담당",
       "type": "staff",
       "required": true
      },
      {
       "id": "due",
       "label": "기한",
       "type": "date",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "meetings.regenerateMeetingAnalysis"
     ]
    },
    {
     "id": "meetings.cleanup",
     "label": "회의록 정리 요청",
     "mode": "request",
     "draft": {
      "title": "회의록 정리",
      "body": "아래 회의록을 정리(삭제·보관)해 주세요."
     },
     "fields": [
      {
       "id": "title",
       "label": "회의록 제목",
       "type": "text",
       "required": true
      },
      {
       "id": "memo",
       "label": "정리 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "meetings.deleteMeeting"
     ]
    }
   ],
   "relations": [
    "meetings"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 4,
    "operations": 4,
    "operationIds": [
     "meetings.createTextMeeting",
     "meetings.regenerateMeetingAnalysis",
     "meetings.updateMeetingNotepad",
     "meetings.deleteMeeting"
    ]
   }
  },
  {
   "id": "approvals",
   "label": "전자결재",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-approvals",
   "summary": "결재함을 대기·예정·진행·완료로 봅니다.",
   "viewKind": "flow",
   "facets": [
    {
     "id": "all",
     "label": "전체",
     "kind": "box"
    },
    {
     "id": "pending",
     "label": "결재 대기",
     "kind": "box"
    },
    {
     "id": "upcoming",
     "label": "결재 예정",
     "kind": "box"
    },
    {
     "id": "progress",
     "label": "진행",
     "kind": "box"
    },
    {
     "id": "done",
     "label": "완료",
     "kind": "box"
    },
    {
     "id": "rejected",
     "label": "반려·회수",
     "kind": "box"
    },
    {
     "id": "cc",
     "label": "참조",
     "kind": "box"
    },
    {
     "id": "academy",
     "label": "학원 전체 진행",
     "kind": "box"
    }
   ],
   "actions": [
    {
     "id": "approvals.legacy",
     "label": "결재 화면 열기",
     "mode": "navigate",
     "target": {
      "page": "approvals"
     },
     "draft": {
      "title": "결재 화면 열기",
      "body": "업무·결재 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "approvals.draft",
     "label": "기안 미리보기",
     "mode": "preview",
     "draft": {
      "title": "기안 미리보기",
      "body": "결재 문서와 결재선을 확인합니다."
     },
     "fields": [
      {
       "id": "form",
       "label": "양식",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "leave",
         "label": "휴가신청서"
        },
        {
         "value": "proposal",
         "label": "품의서"
        },
        {
         "value": "expense",
         "label": "지출결의서"
        },
        {
         "value": "income",
         "label": "수입결의서"
        }
       ],
       "optionSource": "approvalForm"
      },
      {
       "id": "title",
       "label": "제목",
       "type": "text",
       "required": true
      },
      {
       "id": "body",
       "label": "내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "approvals.submitLeaveDraft",
      "approvals.saveLineTemplate"
     ]
    },
    {
     "id": "approvals.decide",
     "label": "결재 결정 미리보기",
     "mode": "preview",
     "draft": {
      "title": "결재 결정 미리보기",
      "body": "결정 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "doc",
       "label": "문서 제목",
       "type": "text",
       "required": true
      },
      {
       "id": "decision",
       "label": "결정",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "approved",
         "label": "승인"
        },
        {
         "value": "rejected",
         "label": "반려"
        },
        {
         "value": "final",
         "label": "전결"
        }
       ],
       "optionSource": "inline-verified"
      },
      {
       "id": "memo",
       "label": "의견",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "approvals.decideDocument",
      "approvals.addApprovalComment"
     ]
    }
   ],
   "relations": [
    "approvals"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 3,
    "operations": 4,
    "operationIds": [
     "approvals.submitLeaveDraft",
     "approvals.decideDocument",
     "approvals.addApprovalComment",
     "approvals.saveLineTemplate"
    ]
   }
  },
  {
   "id": "documents",
   "label": "데이터베이스",
   "group": "운영",
   "groupId": "operation",
   "page": "workspace-documents",
   "summary": "학원 서식·문서 저장소를 폴더로 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "folders",
     "label": "데이터베이스",
     "kind": "tab"
    },
    {
     "id": "detail",
     "label": "문서 상세",
     "kind": "face"
    },
    {
     "id": "preview",
     "label": "문서 미리보기",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "documents.legacy",
     "label": "문서 보기",
     "mode": "navigate",
     "target": {
      "page": "resources"
     },
     "draft": {
      "title": "문서 보기",
      "body": "교재·재고·서식 화면에서 문서를 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "documents.upload",
     "label": "서식 등록 요청",
     "mode": "request",
     "draft": {
      "title": "서식 등록",
      "body": "아래 서식을 데이터베이스에 등록해 주세요."
     },
     "fields": [
      {
       "id": "title",
       "label": "문서 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "folder",
       "label": "폴더",
       "type": "text"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "documents.registerUploadedDocument",
      "documents.createDocumentCategory"
     ]
    },
    {
     "id": "documents.tidy",
     "label": "문서 정리 요청",
     "mode": "request",
     "draft": {
      "title": "문서 정리",
      "body": "아래 문서를 정리(수정·이동)해 주세요."
     },
     "fields": [
      {
       "id": "title",
       "label": "문서 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "folder",
       "label": "옮길 폴더",
       "type": "text"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "documents.updateDocument",
      "documents.moveDocumentFile"
     ]
    }
   ],
   "relations": [
    "documents"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 3,
    "operations": 4,
    "operationIds": [
     "documents.registerUploadedDocument",
     "documents.updateDocument",
     "documents.createDocumentCategory",
     "documents.moveDocumentFile"
    ]
   }
  },
  {
   "id": "support",
   "label": "고객센터",
   "group": "지원",
   "groupId": "support",
   "page": "workspace-support",
   "summary": "공지사항과 개선요청 처리 상태를 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "notices",
     "label": "공지사항",
     "kind": "tab"
    },
    {
     "id": "requests",
     "label": "개선요청",
     "kind": "tab"
    }
   ],
   "actions": [
    {
     "id": "support.request",
     "label": "개선요청 초안",
     "mode": "preview",
     "draft": {
      "title": "개선요청 미리보기",
      "body": "보낼 개선요청을 확인합니다."
     },
     "fields": [
      {
       "id": "title",
       "label": "제목",
       "type": "text",
       "required": true
      },
      {
       "id": "body",
       "label": "내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "support.createSupportRequest"
     ]
    },
    {
     "id": "support.status",
     "label": "처리 상태 보기",
     "mode": "preview",
     "draft": {
      "title": "개선요청 처리 상태",
      "body": "접수·내용확인·처리중·완료 단계를 봅니다."
     },
     "fields": [
      {
       "id": "status",
       "label": "처리 상태",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "received",
         "label": "접수"
        },
        {
         "value": "checking",
         "label": "내용확인"
        },
        {
         "value": "in_progress",
         "label": "처리중"
        },
        {
         "value": "done",
         "label": "완료"
        }
       ],
       "optionSource": "supportStatus"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "support.answerSupportRequest"
     ]
    }
   ],
   "relations": [
    "support"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 9,
    "operations": 2,
    "operationIds": [
     "support.createSupportRequest",
     "support.answerSupportRequest"
    ]
   }
  },
  {
   "id": "owner-settings",
   "label": "학원 설정",
   "group": "지원",
   "groupId": "support",
   "page": "workspace-owner-settings",
   "summary": "학원 설정 18개 면(프로필·운영·과목·청구·권한·메뉴·연동 등)을 봅니다.",
   "viewKind": "settings",
   "facets": [
    {
     "id": "profile",
     "label": "프로필·브랜드",
     "kind": "face"
    },
    {
     "id": "operations",
     "label": "운영 체계",
     "kind": "face"
    },
    {
     "id": "subjects",
     "label": "과목 운영",
     "kind": "face"
    },
    {
     "id": "makeups",
     "label": "보강 운영",
     "kind": "face"
    },
    {
     "id": "evaluation",
     "label": "강사평가",
     "kind": "face"
    },
    {
     "id": "contribution",
     "label": "원생 기여도",
     "kind": "face"
    },
    {
     "id": "billing",
     "label": "수납·청구",
     "kind": "face"
    },
    {
     "id": "notifications",
     "label": "알림·약관",
     "kind": "face"
    },
    {
     "id": "consultations",
     "label": "상담 양식",
     "kind": "face"
    },
    {
     "id": "permissions",
     "label": "역할·권한",
     "kind": "face"
    },
    {
     "id": "navigation",
     "label": "탭 및 메뉴 구성",
     "kind": "face"
    },
    {
     "id": "modules",
     "label": "기능",
     "kind": "face"
    },
    {
     "id": "dashboard",
     "label": "대시보드 관리",
     "kind": "face"
    },
    {
     "id": "popups",
     "label": "팝업 공지",
     "kind": "face"
    },
    {
     "id": "data",
     "label": "데이터 정리",
     "kind": "face"
    },
    {
     "id": "import",
     "label": "데이터 가져오기",
     "kind": "face"
    },
    {
     "id": "audit",
     "label": "감사로그",
     "kind": "face"
    },
    {
     "id": "sheets",
     "label": "연동",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "owner-settings.legacy",
     "label": "설정 화면 열기",
     "mode": "navigate",
     "target": {
      "page": "settings"
     },
     "draft": {
      "title": "설정 화면 열기",
      "body": "학원 설정 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": []
    },
    {
     "id": "owner-settings.face",
     "label": "설정 면 미리보기",
     "mode": "preview",
     "draft": {
      "title": "학원 설정 면",
      "body": "고른 설정 면의 항목을 봅니다."
     },
     "fields": [
      {
       "id": "face",
       "label": "설정 면",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "profile",
         "label": "프로필·브랜드"
        },
        {
         "value": "operations",
         "label": "운영 체계"
        },
        {
         "value": "subjects",
         "label": "과목 운영"
        },
        {
         "value": "makeups",
         "label": "보강 운영"
        },
        {
         "value": "evaluation",
         "label": "강사평가"
        },
        {
         "value": "contribution",
         "label": "원생 기여도"
        },
        {
         "value": "billing",
         "label": "수납·청구"
        },
        {
         "value": "notifications",
         "label": "알림·약관"
        },
        {
         "value": "consultations",
         "label": "상담 양식"
        },
        {
         "value": "permissions",
         "label": "역할·권한"
        },
        {
         "value": "navigation",
         "label": "탭 및 메뉴 구성"
        },
        {
         "value": "modules",
         "label": "기능"
        },
        {
         "value": "dashboard",
         "label": "대시보드 관리"
        },
        {
         "value": "popups",
         "label": "팝업 공지"
        },
        {
         "value": "data",
         "label": "데이터 정리"
        },
        {
         "value": "import",
         "label": "데이터 가져오기"
        },
        {
         "value": "audit",
         "label": "감사로그"
        },
        {
         "value": "sheets",
         "label": "연동"
        }
       ],
       "optionSource": "ownerFace"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "owner-settings.saveOwnerSection",
      "owner-settings.saveSettingRoles"
     ]
    },
    {
     "id": "owner-settings.classroom",
     "label": "강의실 추가",
     "mode": "preview",
     "draft": {
      "title": "강의실 미리보기",
      "body": "강의실 목록에 추가될 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "name",
       "label": "강의실 이름",
       "type": "text",
       "required": true
      },
      {
       "id": "capacity",
       "label": "정원",
       "type": "number"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "owner-settings.createClassroom"
     ]
    },
    {
     "id": "owner-settings.subject",
     "label": "과목 정리 요청",
     "mode": "request",
     "draft": {
      "title": "과목 정리",
      "body": "아래 과목을 다른 과목으로 흡수하고 세션 기간을 맞춰 주세요."
     },
     "fields": [
      {
       "id": "from",
       "label": "정리할 과목",
       "type": "text",
       "required": true
      },
      {
       "id": "to",
       "label": "옮겨 갈 과목",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "owner-settings.absorbSubject",
      "owner-settings.savePeriodsForSubject"
     ]
    },
    {
     "id": "owner-settings.popup",
     "label": "팝업 공지 미리보기",
     "mode": "preview",
     "draft": {
      "title": "팝업 공지 미리보기",
      "body": "직원 화면에 뜰 팝업 공지를 확인합니다."
     },
     "fields": [
      {
       "id": "title",
       "label": "제목",
       "type": "text",
       "required": true
      },
      {
       "id": "body",
       "label": "내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "owner-settings.createNoticePopup"
     ]
    },
    {
     "id": "owner-settings.data",
     "label": "데이터 정리 요청",
     "mode": "request",
     "draft": {
      "title": "데이터 정리",
      "body": "아래 원생의 데이터를 정리해 주세요(중복 원생 병합 등)."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "정리 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "owner-settings.mergeStudents",
      "students.progress-backfill",
      "students.dup-suspect"
     ]
    }
   ],
   "relations": [
    "owner-settings",
    "students"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 6,
    "operations": 7,
    "operationIds": [
     "owner-settings.saveOwnerSection",
     "owner-settings.createClassroom",
     "owner-settings.absorbSubject",
     "owner-settings.savePeriodsForSubject",
     "owner-settings.createNoticePopup",
     "owner-settings.mergeStudents",
     "owner-settings.saveSettingRoles"
    ]
   }
  },
  {
   "id": "help",
   "label": "도움말",
   "group": "지원",
   "groupId": "support",
   "page": "workspace-help",
   "summary": "화면 설명서와 질문 게시판을 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "manuals",
     "label": "도움말",
     "kind": "tab"
    },
    {
     "id": "icons",
     "label": "아이콘 시스템",
     "kind": "face"
    },
    {
     "id": "posts",
     "label": "도움말 질문",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "help.ask",
     "label": "질문 초안",
     "mode": "preview",
     "draft": {
      "title": "도움말 질문 미리보기",
      "body": "질문 게시판에 올릴 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "title",
       "label": "제목",
       "type": "text",
       "required": true
      },
      {
       "id": "body",
       "label": "내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "help.createHelpPost"
     ]
    }
   ],
   "relations": [
    "help"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P2",
    "sourceRoutes": 5,
    "operations": 1,
    "operationIds": [
     "help.createHelpPost"
    ]
   }
  },
  {
   "id": "slack",
   "label": "슬랙 연동",
   "group": "연동·자동화",
   "groupId": "integration",
   "page": "workspace-slack",
   "summary": "슬랙으로 무엇을 어디로 언제 보낼지 규칙을 봅니다.",
   "viewKind": "settings",
   "facets": [
    {
     "id": "rules",
     "label": "규칙",
     "kind": "tab"
    },
    {
     "id": "settings",
     "label": "슬랙 연결",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "slack.automation",
     "label": "자동화 설정",
     "mode": "navigate",
     "target": {
      "page": "automation"
     },
     "draft": {
      "title": "자동화 설정",
      "body": "자동화 화면을 엽니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "slack.saveSlackSchedule"
     ]
    },
    {
     "id": "slack.rule",
     "label": "규칙 미리보기",
     "mode": "preview",
     "draft": {
      "title": "슬랙 규칙 미리보기",
      "body": "고른 범주의 알림이 어디로 가는지 확인합니다."
     },
     "fields": [
      {
       "id": "categories",
       "label": "활동 범주",
       "type": "multiselect",
       "required": true,
       "options": [
        {
         "value": "students",
         "label": "원생·수강"
        },
        {
         "value": "consult",
         "label": "신규 콜&상담·학생상담"
        },
        {
         "value": "attendance",
         "label": "출결·보강·자리"
        },
        {
         "value": "billing",
         "label": "청구·수납·지출"
        },
        {
         "value": "payroll",
         "label": "급여"
        },
        {
         "value": "classes",
         "label": "반·시간표·강의실"
        },
        {
         "value": "reports",
         "label": "보고서·학부모 발송"
        },
        {
         "value": "sheets",
         "label": "강사 시트·교재·성적"
        },
        {
         "value": "staff",
         "label": "직원·결재·연차"
        },
        {
         "value": "comms",
         "label": "일정·공지·회의·도움말"
        },
        {
         "value": "ops",
         "label": "셔틀·재고"
        },
        {
         "value": "settings",
         "label": "설정·연동"
        }
       ],
       "optionSource": "slackCategory"
      },
      {
       "id": "target",
       "label": "보낼 곳",
       "type": "text",
       "required": true
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "slack.saveSlackRule"
     ]
    },
    {
     "id": "slack.connect",
     "label": "슬랙 연결 요청",
     "mode": "request",
     "draft": {
      "title": "슬랙 연결",
      "body": "학원 슬랙 워크스페이스를 연결하고 직원 계정을 이어 주세요."
     },
     "fields": [
      {
       "id": "memo",
       "label": "연결할 워크스페이스·사람",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "slack.saveSlackToken",
      "slack.linkSlackByEmail"
     ]
    }
   ],
   "relations": [
    "slack"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 0,
    "operations": 4,
    "operationIds": [
     "slack.saveSlackToken",
     "slack.saveSlackRule",
     "slack.saveSlackSchedule",
     "slack.linkSlackByEmail"
    ]
   }
  },
  {
   "id": "integrations",
   "label": "외부 연동",
   "group": "연동·자동화",
   "groupId": "integration",
   "page": "workspace-integrations",
   "summary": "메이크에듀·구글 시트·숙제영상 드라이브·연동 PC·오늘 수학 연결을 봅니다.",
   "viewKind": "settings",
   "facets": [
    {
     "id": "makeedu",
     "label": "메이크에듀 동기화",
     "kind": "face"
    },
    {
     "id": "sheets",
     "label": "구글 시트",
     "kind": "face"
    },
    {
     "id": "video",
     "label": "숙제영상 드라이브",
     "kind": "face"
    },
    {
     "id": "agent",
     "label": "연동 PC",
     "kind": "face"
    },
    {
     "id": "todaysMath",
     "label": "오늘 수학",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "integrations.status",
     "label": "연동 상태 보기",
     "mode": "preview",
     "draft": {
      "title": "연동 상태",
      "body": "연동의 켜짐 여부와 최근 이력을 봅니다."
     },
     "fields": [
      {
       "id": "target",
       "label": "연동",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "makeedu",
         "label": "makeedu 동기화"
        },
        {
         "value": "sheets",
         "label": "구글 시트"
        },
        {
         "value": "video",
         "label": "숙제영상 드라이브"
        },
        {
         "value": "agent",
         "label": "연동 PC"
        },
        {
         "value": "todaysMath",
         "label": "오늘 수학"
        }
       ],
       "optionSource": "integrationSub"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "integrations.setMakeeduSyncEnabled",
      "integrations.setSheetsExportEnabled",
      "integrations.loadTodaysMathMenus"
     ]
    },
    {
     "id": "integrations.agent",
     "label": "연동 PC 점검 요청",
     "mode": "request",
     "draft": {
      "title": "연동 PC 점검",
      "body": "연동 PC의 상태를 확인하고 필요하면 다시 연결해 주세요."
     },
     "fields": [
      {
       "id": "memo",
       "label": "증상",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "integrations.issueAgentCode"
     ]
    },
    {
     "id": "integrations.ijw",
     "label": "인재원 연결 정리 요청",
     "mode": "request",
     "draft": {
      "title": "인재원 학생 한 번에 연결",
      "body": "인재원 학생 가운데 이름이 양쪽 모두 하나뿐인 학생을 확인하고 원생과 연결해 주세요."
     },
     "fields": [
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "integrations.linkIjwUniqueMatches"
     ]
    }
   ],
   "relations": [
    "integrations"
   ],
   "meta": {
    "ownerScope": "owner",
    "priority": "P1",
    "sourceRoutes": 0,
    "operations": 5,
    "operationIds": [
     "integrations.setMakeeduSyncEnabled",
     "integrations.setSheetsExportEnabled",
     "integrations.issueAgentCode",
     "integrations.loadTodaysMathMenus",
     "integrations.linkIjwUniqueMatches"
    ]
   }
  },
  {
   "id": "teacher-workspace",
   "label": "강사 화면",
   "group": "역할별 화면",
   "groupId": "roles",
   "page": "workspace-teacher-workspace",
   "summary": "선생님이 보는 내 메뉴·내 정보 화면을 미리 봅니다.",
   "viewKind": "records",
   "facets": [
    {
     "id": "me",
     "label": "내 정보",
     "kind": "tab"
    },
    {
     "id": "onescreen",
     "label": "선생님 수업보고서",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "teacher-workspace.preview",
     "label": "강사 화면 미리보기",
     "mode": "preview",
     "draft": {
      "title": "강사 화면 미리보기",
      "body": "선생님 내 메뉴와 언어 설정을 봅니다."
     },
     "fields": [
      {
       "id": "staff",
       "label": "선생님",
       "type": "staff",
       "required": true
      },
      {
       "id": "lang",
       "label": "화면 언어",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "ko",
         "label": "한국어"
        },
        {
         "value": "en",
         "label": "English"
        }
       ],
       "optionSource": "inline-verified"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "teacher-workspace.setMyTeacherLang",
      "teacher-workspace.switchToTeacherView"
     ]
    },
    {
     "id": "teacher-workspace.account",
     "label": "계정 정보 정리 요청",
     "mode": "request",
     "draft": {
      "title": "계정 정보 정리",
      "body": "선생님 계정의 이메일·보고서 이름을 정리해 주세요."
     },
     "fields": [
      {
       "id": "staff",
       "label": "선생님",
       "type": "staff",
       "required": true
      },
      {
       "id": "memo",
       "label": "바꿀 내용",
       "type": "textarea",
       "required": true
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "teacher-workspace.updateMyEmail"
     ]
    }
   ],
   "relations": [
    "teacher-workspace"
   ],
   "meta": {
    "ownerScope": "owner-linked",
    "priority": "P1",
    "sourceRoutes": 1,
    "operations": 3,
    "operationIds": [
     "teacher-workspace.updateMyEmail",
     "teacher-workspace.setMyTeacherLang",
     "teacher-workspace.switchToTeacherView"
    ]
   }
  },
  {
   "id": "parent-portal",
   "label": "학부모 화면",
   "group": "역할별 화면",
   "groupId": "roles",
   "page": "workspace-parent-portal",
   "summary": "학부모가 보는 셔틀·수업 시간표 화면을 미리 봅니다.",
   "viewKind": "timeline",
   "facets": [
    {
     "id": "live",
     "label": "실시간 차량",
     "kind": "tab"
    },
    {
     "id": "rides",
     "label": "등하원 시간 변경·확인",
     "kind": "tab"
    },
    {
     "id": "classes",
     "label": "수업 시간표",
     "kind": "tab"
    }
   ],
   "actions": [
    {
     "id": "parent-portal.change",
     "label": "학부모 변경 요청 미리보기",
     "mode": "preview",
     "draft": {
      "title": "학부모 변경 요청",
      "body": "학부모가 등하원을 바꿨을 때 직원에게 보이는 내용을 확인합니다."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "date",
       "label": "날짜",
       "type": "date",
       "required": true
      },
      {
       "id": "kind",
       "label": "변경",
       "type": "select",
       "required": true,
       "options": [
        {
         "value": "absent",
         "label": "안 탐"
        },
        {
         "value": "stop",
         "label": "정류장 변경"
        }
       ],
       "optionSource": "inline-verified"
      }
     ],
     "result": {
      "label": "미리보기 — 저장되지 않습니다",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "parent-portal.absentParentRide",
      "parent-portal.changeRegularRide"
     ]
    },
    {
     "id": "parent-portal.ack",
     "label": "변경 확인 요청",
     "mode": "request",
     "draft": {
      "title": "학부모 변경 확인",
      "body": "학부모가 바꾼 등하원 내역을 확인해 주세요."
     },
     "fields": [
      {
       "id": "student",
       "label": "원생",
       "type": "student",
       "required": true
      },
      {
       "id": "memo",
       "label": "메모",
       "type": "textarea"
      }
     ],
     "result": {
      "label": "요청 초안으로 열기",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "parent-portal.ackShuttleHistory"
     ]
    }
   ],
   "relations": [
    "parent-portal"
   ],
   "meta": {
    "ownerScope": "owner-linked",
    "priority": "P2",
    "sourceRoutes": 4,
    "operations": 3,
    "operationIds": [
     "parent-portal.absentParentRide",
     "parent-portal.changeRegularRide",
     "parent-portal.ackShuttleHistory"
    ]
   }
  },
  {
   "id": "student-portal",
   "label": "학생 화면",
   "group": "역할별 화면",
   "groupId": "roles",
   "page": "workspace-student-portal",
   "summary": "학생이 보는 내 학습 화면을 미리 봅니다(예시 데이터).",
   "viewKind": "report",
   "facets": [
    {
     "id": "summary",
     "label": "내 학습 현황",
     "kind": "tab"
    },
    {
     "id": "report",
     "label": "데일리 리포트",
     "kind": "face"
    }
   ],
   "actions": [
    {
     "id": "student-portal.preview",
     "label": "학생 화면 미리보기",
     "mode": "navigate",
     "target": {
      "page": "workspace-student-portal",
      "facet": "summary"
     },
     "draft": {
      "title": "학생 화면 미리보기",
      "body": "학생 화면 구성을 봅니다. 실제 학생 데이터가 아닌 예시 데이터로 그립니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "student-portal.page-my-learning"
     ]
    }
   ],
   "relations": [
    "student-portal"
   ],
   "meta": {
    "ownerScope": "owner-linked",
    "priority": "P2",
    "sourceRoutes": 2,
    "operations": 1,
    "operationIds": [
     "student-portal.page-my-learning"
    ]
   }
  },
  {
   "id": "public-sites",
   "label": "학원 공개 페이지",
   "group": "역할별 화면",
   "groupId": "roles",
   "page": "workspace-public-sites",
   "summary": "학부모에게 보이는 학원 공개 페이지를 미리 봅니다.",
   "viewKind": "report",
   "facets": [
    {
     "id": "academy",
     "label": "학원 공개 페이지",
     "kind": "tab"
    }
   ],
   "actions": [
    {
     "id": "public-sites.academy",
     "label": "학원 공개 페이지 미리보기",
     "mode": "navigate",
     "target": {
      "page": "workspace-public-sites",
      "facet": "academy"
     },
     "draft": {
      "title": "학원 공개 페이지 미리보기",
      "body": "학원 브랜드로 그려지는 공개 페이지를 봅니다."
     },
     "fields": [],
     "result": {
      "label": "화면 이동",
      "liveWrite": false
     },
     "sourceOperationIds": [
      "public-sites.page-root"
     ]
    }
   ],
   "relations": [
    "public-sites"
   ],
   "meta": {
    "ownerScope": "owner-linked",
    "priority": "P2",
    "sourceRoutes": 2,
    "operations": 1,
    "operationIds": [
     "public-sites.page-root"
    ]
   }
  }
 ],
 "auditOnly": {
  "count": 6,
  "ids": [
   "auth-session",
   "platform-console",
   "recording-transcription",
   "shell-infrastructure",
   "demo-tenant",
   "dev-tools"
  ]
 },
 "coverage": {
  "ownerVisibleFamilies": 41,
  "auditOnlyFamilies": 6,
  "areas": 41,
  "facets": 198,
  "actions": 151,
  "actionsByMode": {
   "navigate": 31,
   "preview": 73,
   "request": 47
  },
  "ownerVisibleOperations": 177,
  "operationsWithDestination": 177,
  "productionLinkedWrites": 0,
  "discoveredGroups": 28,
  "operationDestinations": {
   "approvals.addApprovalComment": [
    "approvals.decide"
   ],
   "approvals.decideDocument": [
    "approvals.decide"
   ],
   "approvals.saveLineTemplate": [
    "approvals.draft"
   ],
   "approvals.submitLeaveDraft": [
    "approvals.draft"
   ],
   "attendance.api-attendance-checkin": [
    "attendance.kiosk"
   ],
   "attendance.generateRecapSummary": [
    "attendance.recap"
   ],
   "attendance.previewAbsenceIntake": [
    "attendance.intake"
   ],
   "attendance.registerKioskDevice": [
    "attendance.kiosk"
   ],
   "attendance.requestDeskConfirm": [
    "attendance.absence-call"
   ],
   "attendance.reserveMakeup": [
    "attendance.makeup"
   ],
   "attendance.saveAttendanceSalaryRates": [
    "attendance.salary"
   ],
   "attendance.seat-jj": [
    "class-sheets.missing"
   ],
   "attendance.seat-plan": [
    "class-sheets.goal"
   ],
   "attendance.setAttendanceCell": [
    "attendance.mark"
   ],
   "attendance.setSeatCell": [
    "attendance.mark"
   ],
   "billing.confirmSessionTerm": [
    "billing.session"
   ],
   "billing.createExpense": [
    "billing.expense"
   ],
   "billing.createInvoice": [
    "billing.remind"
   ],
   "billing.createTextbookOrder": [
    "billing.textbook"
   ],
   "billing.createTuitionItem": [
    "billing.quote"
   ],
   "billing.saveRefundRequest": [
    "billing.refund"
   ],
   "billing.saveSeatShareAdjust": [
    "billing.session"
   ],
   "billing.saveTuitionQuote": [
    "billing.quote"
   ],
   "calendar.saveCalendarEvent": [
    "calendar.event"
   ],
   "calendar.saveCalendarTag": [
    "calendar.tag"
   ],
   "class-review.createClassReview": [
    "class-review.open"
   ],
   "class-review.decideJudgment": [
    "class-review.portfolio"
   ],
   "class-review.refreshTeacherPortfolioNow": [
    "class-review.portfolio"
   ],
   "class-review.saveChecklistTemplate": [
    "class-review.criteria"
   ],
   "class-review.saveEvaluationSettings": [
    "class-review.criteria"
   ],
   "class-sheets.copyWeekFromPrevious": [
    "class-sheets.goal"
   ],
   "class-sheets.ecs-attendance": [
    "attendance.mark"
   ],
   "class-sheets.ecs-makeup-remove": [
    "onescreen.makeup"
   ],
   "class-sheets.mcs-goals": [
    "class-sheets.math"
   ],
   "class-sheets.pullEcsMemorizedWords": [
    "class-sheets.missing"
   ],
   "class-sheets.saveMathLearningGoals": [
    "class-sheets.math"
   ],
   "class-sheets.saveMonthPlanCells": [
    "class-sheets.goal"
   ],
   "class-sheets.shouting": [
    "class-sheets.missing"
   ],
   "class-sheets.upsertGoal": [
    "class-sheets.goal"
   ],
   "class-sheets.upsertStudentMark": [
    "class-sheets.missing"
   ],
   "classes.classroom-auto": [
    "classes.classroom-auto"
   ],
   "classes.createClass": [
    "classes.open"
   ],
   "classes.createClassDelegation": [
    "classes.delegation"
   ],
   "classes.createEnrollment": [
    "classes.enroll"
   ],
   "classes.endClassTerm": [
    "classes.term-end"
   ],
   "classes.rescheduleEnrollment": [
    "classes.enroll"
   ],
   "classes.scheduleHandover": [
    "classes.handover"
   ],
   "consultations.createStudentConsultation": [
    "consultations.write"
   ],
   "consultations.startStudentConsultationFromAudio": [
    "consultations.audio"
   ],
   "consultations.toggleConsultationFollowUp": [
    "consultations.followup"
   ],
   "dashboard.createAnnouncement": [
    "dashboard.announcement"
   ],
   "dashboard.refreshClassroomPreview": [
    "dashboard.kpi"
   ],
   "dashboard.refreshOverview": [
    "dashboard.kpi"
   ],
   "dashboard.regenerateDailyBriefing": [
    "dashboard.briefing"
   ],
   "dashboard.saveDashboardChartKind": [
    "dashboard.kpi"
   ],
   "dashboard.setOnboardingDismissed": [
    "dashboard.kpi"
   ],
   "documents.createDocumentCategory": [
    "documents.upload"
   ],
   "documents.moveDocumentFile": [
    "documents.tidy"
   ],
   "documents.registerUploadedDocument": [
    "documents.upload"
   ],
   "documents.updateDocument": [
    "documents.tidy"
   ],
   "enrollment.convertConsultationToStudent": [
    "enrollment.convert"
   ],
   "enrollment.createEnrollmentConsultation": [
    "enrollment.write"
   ],
   "enrollment.createIntakeToken": [
    "enrollment.qr"
   ],
   "enrollment.enqueueConsultationPush": [
    "enrollment.makeedu"
   ],
   "enrollment.regenerateConsultationAnalysis": [
    "enrollment.brief"
   ],
   "enrollment.setEnrollmentOutcome": [
    "enrollment.outcome"
   ],
   "exams.importGradesExcel": [
    "exams.excel"
   ],
   "exams.linkIjwStudent": [
    "exams.ijw"
   ],
   "exams.saveGradeScores": [
    "exams.score"
   ],
   "expense-requests.deleteExpense": [
    "expense-requests.review"
   ],
   "help.createHelpPost": [
    "help.ask"
   ],
   "integrations.issueAgentCode": [
    "integrations.agent"
   ],
   "integrations.linkIjwUniqueMatches": [
    "integrations.ijw"
   ],
   "integrations.loadTodaysMathMenus": [
    "integrations.status"
   ],
   "integrations.setMakeeduSyncEnabled": [
    "integrations.status"
   ],
   "integrations.setSheetsExportEnabled": [
    "integrations.status"
   ],
   "inventory.createAsset": [
    "inventory.asset"
   ],
   "inventory.createSupply": [
    "inventory.supply"
   ],
   "inventory.createVendor": [
    "inventory.supply"
   ],
   "inventory.importInventoryExcel": [
    "inventory.asset"
   ],
   "inventory.recordAudit": [
    "inventory.audit"
   ],
   "inventory.startLoan": [
    "inventory.loan"
   ],
   "lesson-reports.linkClassnoteChild": [
    "lesson-reports.board"
   ],
   "lesson-reports.listReports": [
    "lesson-reports.queue"
   ],
   "lesson-reports.previewClassNotice": [
    "lesson-reports.notice"
   ],
   "lesson-reports.refreshClassnoteQueue": [
    "lesson-reports.queue"
   ],
   "lesson-reports.requestParentReply": [
    "lesson-reports.reply"
   ],
   "lesson-reports.requestReportRecall": [
    "lesson-reports.recall"
   ],
   "lesson-reports.saveAdminReport": [
    "lesson-reports.compose"
   ],
   "makeups.executeMakeupCommand": [
    "makeups.intake",
    "makeups.plan",
    "makeups.owner"
   ],
   "makeups.loadMakeupEvents": [
    "makeups.history"
   ],
   "makeups.searchMakeupOptions": [
    "makeups.plan"
   ],
   "meetings.createTextMeeting": [
    "meetings.text"
   ],
   "meetings.deleteMeeting": [
    "meetings.cleanup"
   ],
   "meetings.regenerateMeetingAnalysis": [
    "meetings.followup"
   ],
   "meetings.updateMeetingNotepad": [
    "meetings.text"
   ],
   "newcomers.setOnboardingCheck": [
    "newcomers.check",
    "newcomers.call"
   ],
   "onescreen.generateReportComment": [
    "onescreen.ment"
   ],
   "onescreen.issueReportAttachmentUploadTicket": [
    "onescreen.unwritten"
   ],
   "onescreen.ment-styles": [
    "onescreen.ment"
   ],
   "onescreen.registerMakeupEntries": [
    "onescreen.makeup"
   ],
   "onescreen.reissueShareLink": [
    "onescreen.share"
   ],
   "onescreen.saveLessonReport": [
    "onescreen.unwritten"
   ],
   "onescreen.saveMyReportTemplate": [
    "onescreen.unwritten"
   ],
   "onescreen.savePrompt": [
    "onescreen.ment"
   ],
   "onescreen.sendOnescreenNotice": [
    "onescreen.notice"
   ],
   "onescreen.trend-optout": [
    "onescreen.ment"
   ],
   "owner-settings.absorbSubject": [
    "owner-settings.subject"
   ],
   "owner-settings.createClassroom": [
    "owner-settings.classroom"
   ],
   "owner-settings.createNoticePopup": [
    "owner-settings.popup"
   ],
   "owner-settings.mergeStudents": [
    "owner-settings.data"
   ],
   "owner-settings.saveOwnerSection": [
    "owner-settings.face"
   ],
   "owner-settings.savePeriodsForSubject": [
    "owner-settings.subject"
   ],
   "owner-settings.saveSettingRoles": [
    "owner-settings.face"
   ],
   "parent-portal.absentParentRide": [
    "parent-portal.change"
   ],
   "parent-portal.ackShuttleHistory": [
    "parent-portal.ack"
   ],
   "parent-portal.changeRegularRide": [
    "parent-portal.change"
   ],
   "payroll.autoComputePayroll": [
    "payroll.payslip"
   ],
   "payroll.issuePayslip": [
    "payroll.payslip"
   ],
   "payroll.saveClassSalary": [
    "payroll.class-salary"
   ],
   "public-sites.page-root": [
    "public-sites.academy"
   ],
   "retention.campaignAdd": [
    "retention.campaign"
   ],
   "retention.logRetentionAction": [
    "retention.contact"
   ],
   "shuttle.assignRider": [
    "shuttle.rider"
   ],
   "shuttle.createParentAccount": [
    "shuttle.parent-account"
   ],
   "shuttle.createRun": [
    "shuttle.run"
   ],
   "shuttle.createStop": [
    "shuttle.run"
   ],
   "shuttle.recordBoarding": [
    "shuttle.boarding"
   ],
   "shuttle.saveVehicle": [
    "shuttle.run"
   ],
   "shuttle.staffChangeRideStop": [
    "shuttle.boarding"
   ],
   "slack.linkSlackByEmail": [
    "slack.connect"
   ],
   "slack.saveSlackRule": [
    "slack.rule"
   ],
   "slack.saveSlackSchedule": [
    "slack.automation"
   ],
   "slack.saveSlackToken": [
    "slack.connect"
   ],
   "staff.addLeaveAdjustment": [
    "staff.leave"
   ],
   "staff.changeStaffEmail": [
    "staff.register"
   ],
   "staff.createStaff": [
    "staff.register"
   ],
   "staff.createStaffTask": [
    "staff.task"
   ],
   "staff.dashboard-assign": [
    "dashboard.layout"
   ],
   "staff.ensureStaffIntakeToken": [
    "staff.register"
   ],
   "staff.requestLeave": [
    "staff.leave"
   ],
   "staff.saveStaffResume": [
    "staff.register"
   ],
   "staff.updateStaffContract": [
    "staff.contract"
   ],
   "staff.work-schedule": [
    "staff.schedule"
   ],
   "student-contribution.generateStudentRecordSummary": [
    "student-contribution.summary"
   ],
   "student-contribution.refreshContribution": [
    "student-contribution.list"
   ],
   "student-contribution.saveContributionSettings": [
    "student-contribution.settings"
   ],
   "student-contribution.searchReviewedReferrers": [
    "student-contribution.referral"
   ],
   "student-portal.page-my-learning": [
    "student-portal.preview"
   ],
   "students.changeStudentStatus": [
    "students.status"
   ],
   "students.createStudent": [
    "students.register"
   ],
   "students.createStudentGrade": [
    "students.grade"
   ],
   "students.createStudentMemo": [
    "students.memo"
   ],
   "students.dup-suspect": [
    "owner-settings.data"
   ],
   "students.endStudentEnrollments": [
    "students.end"
   ],
   "students.progress-backfill": [
    "owner-settings.data"
   ],
   "students.setProgressAnomalyResolved": [
    "students.progress"
   ],
   "students.updateStudentEnglishName": [
    "students.register"
   ],
   "support.answerSupportRequest": [
    "support.status"
   ],
   "support.createSupportRequest": [
    "support.request"
   ],
   "tasks-notifications.api-staff-tasks": [
    "tasks-notifications.kind",
    "tasks-notifications.follow"
   ],
   "tasks-notifications.markNotificationsRead": [
    "tasks-notifications.inbox"
   ],
   "teacher-workspace.setMyTeacherLang": [
    "teacher-workspace.preview"
   ],
   "teacher-workspace.switchToTeacherView": [
    "teacher-workspace.preview"
   ],
   "teacher-workspace.updateMyEmail": [
    "teacher-workspace.account"
   ],
   "textbook-requests.prepareTextbookNotice": [
    "textbook-requests.notice"
   ],
   "textbook-requests.registerTextbookAttachment": [
    "textbook-requests.order"
   ],
   "textbook-requests.requestTextbook": [
    "textbook-requests.order"
   ],
   "textbooks.plan-compare": [
    "class-sheets.gap"
   ],
   "textbooks.previewTextbookFill": [
    "textbooks.fill"
   ],
   "textbooks.registerTextbookCover": [
    "textbooks.book"
   ],
   "textbooks.saveMathTextbookAssignment": [
    "textbooks.fill"
   ],
   "textbooks.saveTextbook": [
    "textbooks.book"
   ],
   "textbooks.setLessonShift": [
    "textbooks.shift"
   ],
   "timetable.class-level": [
    "classes.level"
   ],
   "timetable.createClassSplit": [
    "timetable.move"
   ],
   "timetable.moveClassSlots": [
    "timetable.move"
   ],
   "timetable.previewMasterSheet": [
    "timetable.import"
   ],
   "timetable.previewMathSheetBundle": [
    "timetable.import"
   ],
   "timetable.previewSheetImport": [
    "timetable.import"
   ],
   "timetable.previewTimetableLabApply": [
    "timetable.editor"
   ],
   "timetable.saveMemoSheet": [
    "timetable.memo"
   ],
   "video-homework.api-video-submit-start": [
    "video-homework.site"
   ],
   "video-homework.assignHomeworkVideo": [
    "video-homework.assign"
   ],
   "video-homework.rerunVideoReview": [
    "video-homework.review"
   ],
   "video-homework.revokeVideoSubmitLinks": [
    "video-homework.site"
   ],
   "video-homework.setVideoHomeworkMark": [
    "video-homework.mark"
   ],
   "withdrawal-reports.changeWithdrawalReport": [
    "withdrawal-reports.decide"
   ],
   "withdrawal-reports.mapArchive": [
    "withdrawal-reports.archive"
   ],
   "withdrawal-reports.requestWithdrawalReport": [
    "withdrawal-reports.request"
   ],
   "withdrawals.reactivateStudent": [
    "withdrawals.reactivate"
   ],
   "withdrawals.updateWithdrawalReason": [
    "withdrawals.reason"
   ]
  },
  "operationFacets": {
   "attendance.change-poll": {
    "page": "workspace-attendance",
    "facet": "live"
   },
   "attendance.hub-search": {
    "page": "workspace-attendance",
    "facet": "monthly"
   },
   "class-review.portfolio-compare": {
    "page": "workspace-class-review",
    "facet": "portfolio"
   },
   "class-sheets.day-plan": {
    "page": "workspace-class-sheets",
    "facet": "ecs"
   },
   "documents.view": {
    "page": "workspace-documents",
    "facet": "preview"
   },
   "enrollment.count-poll": {
    "page": "workspace-enrollment",
    "facet": "pending"
   },
   "onescreen.report-reads": {
    "page": "workspace-onescreen",
    "facet": "reports"
   },
   "shuttle.live-map": {
    "page": "workspace-shuttle",
    "facet": "live"
   },
   "shuttle.parent-live": {
    "page": "workspace-parent-portal",
    "facet": "live"
   },
   "student-contribution.evidence-reads": {
    "page": "workspace-student-contribution",
    "facet": "ontology"
   },
   "withdrawals.exit-overlay": {
    "page": "workspace-timetable",
    "facet": "board"
   }
  }
 }
};
window.dispatchEvent(new Event('ax-catalog'));
