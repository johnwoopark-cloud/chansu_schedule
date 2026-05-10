import pandas as pd
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
import os

# 1. 일정 로드
deadlines = pd.read_csv('deadlines.csv')
today = datetime.now().date()

def send_email(subject, body):
    # GitHub Secrets에서 정보 가져오기
    sender_email = os.environ['EMAIL_USER']
    sender_password = os.environ['EMAIL_PASS']
    receiver_email = os.environ['RECEIVER_EMAIL']

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = sender_email
    msg['To'] = receiver_email

    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
        server.login(sender_email, sender_password)
        server.sendmail(sender_email, receiver_email, msg.as_string())

# 2. 로직 확인
for _, row in deadlines.iterrows():
    target_date = datetime.strptime(row['date'], '%Y-%m-%d').date()
    diff = (target_date - today).days

    should_notify = False
    if diff == 30: # 1달 전
        should_notify = True
    elif diff == 14: # 2주 전
        should_notify = True
    elif diff <= 7 and diff > 0: # 1주 전부터 매일
        should_notify = True

    if should_notify:
        subject = f"[알림] '{row['title']}' 기한이 {diff}일 남았습니다!"
        body = f"중요한 학사일정을 확인하세요.\n일정: {row['title']}\n날짜: {row['date']}"
        send_email(subject, body)
        print(f"Sent notification for {row['title']}")
