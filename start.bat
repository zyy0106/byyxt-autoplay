@echo off
chcp 65001 >nul
title byyxt 视频自动播放
cd /d "%~dp0"

echo ==============================================
echo   byyxt 云学堂 视频自动播放工具
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。
  echo.
  echo 解决办法:
  echo   1. 打开浏览器,输入网址  https://nodejs.org/zh-cn  回车;
  echo   2. 点绿色按钮 "LTS" 下载安装包;
  echo   3. 双击安装包,一路点 "下一步",最后点 "安装";
  echo   4. 安装完成后,重新双击本文件。
  echo.
  pause
  exit /b 1
)

echo 正在启动...
echo 提示:首次运行会自动下载所需组件(约 150MB,需联网,只需一次),
echo      下载期间请不要关闭本窗口。
echo.
node start.js %*

echo.
echo ==============================================
echo  运行结束。上方若没有红色报错,即表示已完成。
echo  结果保存在同目录的 result.json 文件里。
echo ==============================================
pause
