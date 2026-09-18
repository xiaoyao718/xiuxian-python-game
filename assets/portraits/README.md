# 第一卷角色立绘

第一卷已经接入按章节和说话人映射的正式半身像。林慕按修为和场景换装，配角只在有对应素材的对白中出现；没有素材的角色继续使用纯文字对白，不套用错误身份的通用头像。

当前文件：

```text
linmu-lv1-v1.png       # 杂役灰袍
linmu-lv2-v1.png       # 灵兽苑工装
linmu-lv3-v1.png       # 外门袍
linmu-lv4-v1.png       # 试炼短披
linmu-lv5-v1.png       # 夜行披风
linmu-boss-v1.png      # 静台素衣
lintao-v1.png
zhouxian-v1.png
zhang-guanshi-v1.png
```

渲染器从 `js/game.js` 的 `portraitsByLevel` 映射读取文件，路径统一为 `assets/portraits/`。图片会锚在对白左侧并随对白入场；加载失败时只移除立绘，不会阻塞剧情。旁白不显示立绘槽。
