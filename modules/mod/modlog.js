module.exports.config = {
  name: 'modlog',
  invokers: ['modlog'],
  help: 'Modlogging-power thing. Log stuff that happens',
  expandedHelp:'WIP, You are warned!',
  usage: ['help', 'modlog help']
}

const Discord = require('discord.js')
const Time = require('./time.js')
const escapeMarkdown = Discord.Util.escapeMarkdown

const HOUR_MS = 3600000
const colors = {
  memberAdd: 0x77b255, memberRemove: 0xdd2e44,
  userBan: 0xff0000, userUnban: 0x55acee
}

const prefix = '>'
const settingsTemplate = [
  {name: 'member_add', type: 'boolean', init: true, help: 'Log members who join'},
  {name: 'member_add_new', type: 'number', init: 48, help: 'The time in hours for an account to be marked as "new". 0 to disable.'},
  {name: 'member_add_invite', type: 'boolean', init: false, help: 'Log which invite they used to join'},
  {name: 'member_add_mention', type: 'boolean', init: false, help: 'If to mention the user in the message rather than the embed.'},
  {name: 'member_remove', type: 'boolean', init: true, help: 'Log members who leave (or are kicked)'},
  {name: 'member_remove_roles', type: 'boolean', init: true, help: 'Log a member\'s roles when they leave'},
  {name: 'user_ban', type: 'boolean', init: true, help: 'Log when users are banned.'},
  {name: 'user_unban', type: 'boolean', init: true, help: 'Log when users are unbanned.'},
  {name: 'user_update', type: 'string', init: 'username', help: 'Log a user\'s updates: =[username | avatar | both]'},
  {name: 'delete_bulk', type: 'boolean', init: true, help: 'Log bulk deletes (purges)'},
  {name: 'message_delete', type: 'boolean', init: true, help: 'Log deleted messages'},
]

settingsTemplate.forEach((v, i) => settingsTemplate[i].reg = new RegExp('^' + prefix + v.name + '=(.*)', 'mi'))

// Server: [invites]
const invites = new Map()
// Server: {config}
const configs = new Map()

function fetchConfig(guild, channel = null) {
  if (!channel && guild.channels) {
    channel = guild.channels.find(c => c.topic && c.topic.split('\n').includes(prefix + 'modlog'))
  }

  if (!channel || !channel.topic) {
    // we tried
    return
  }

  if (!channel.topic.split('\n').includes(prefix + 'modlog')) {
    return
  }

  // Parse & store
  const settings = {}

  for (let setting of settingsTemplate) {
    let m
    if (m = channel.topic.match(setting.reg)) {
      const val = toPrim(m[1])

      if (typeof val !== setting.type) continue

      settings[setting.name] = val
    }
  }

  const c = {channel, settings}

  configs.set(guild.id, c)
  return c
}

function getConfig(guild) {
  return configs.get(guild.id) || fetchConfig(guild)
}

function sendLog(channel, emoji, type, message, {embed = null} = {}) {
  const msg = `${emoji} \`[${type}]\`: ${message}`

  if (embed && channel.permissionsFor(channel.client.user).has('EMBED_LINKS')) {
    channel.send(msg, {embed})
  } else {
    channel.send(msg)
  }
}

module.exports.events = {}

module.exports.events.ready = (bot) => {
  for(let guild of bot.guilds) {
    let config = getConfig(guild)
    if (!config) return

    if (config.member_add_invite && guild.me.permissions.has('MANAGE_SERVER')) {
      guild.fetchInvites().then(i => invites.set(guild.id, i))
    }
  }
}

module.exports.events.message = (bot, message) => {
  if (!message.guild) return

  const [cmd, arg] = bot.sleet.shlex(message)

  if (arg && arg.toLowerCase() === 'help') {
    return message.channel.send(`Add \`${prefix}modlog\` to the topic of the channel you want to use, then add an option:\n` + '```asciidoc\n'
      + settingsTemplate.map(s => `= ${s.help}\n${s.name} :: ${s.type} \/\/ [Default: ${s.init}]`).join('\n')
      + '\n```\nAdd `' + prefix + '[setting_name]=[value]` to the channel to set an option.')
  }

  const conf = getConfig(message.guild)

  if (conf) {
    message.channel.send('Here is the current config:\n```js\n' + JSON.stringify({channel: conf.channel.id, settings: conf.settings}, null, 2) + '\n```\nUse `modlog help` for help.')
  } else {
    message.channel.send(`You have no modlog setup, add '${prefix}modlog' to the topic of the channel you want to use.\n`
                        + 'Use `modlog settings` to view available settings.')
  }
}

module.exports.events.channelUpdate = (bot, oldC, newC) => {
  const config = fetchConfig(newC.guild, newC)
  if (!config) return

  if (config.member_add_invite && newC.guild.me.permissions.has('MANAGE_SERVER')
      && !invites.get(newC.guild)) {
    newC.guild.fetchInvites(i => invites.set(newC.guild, i))
  }
}

module.exports.events.guildMemberAdd = async (bot, member) => {
  const config = getConfig(member.guild)
  if (!config || !config.settings.member_add) return

  const msg = `${formatUser(member.user)}`
            + (config.settings.member_add_mention ? ` ${member}` : '')

  const embed = new Discord.RichEmbed()

  const newAcc = (config.settings.member_add_new * HOUR_MS > Date.now() - member.user.createdTimestamp ? '| :warning: New account!' : '')


  const inviter = (config.settings.member_add_invite ? (await getInviter(member.guild)) : null)
  const invMem = (inviter ? '| :mailbox_with_mail: ' + inviter : '')

  embed.setDescription(`${config.settings.member_add_mention ? '' : member + ' | '}
**${member.guild.memberCount}** Members ${invMem} ${newAcc}`)
    .setColor(colors.memberAdd)
    .setFooter(`${Time.trim(Time.since(member.user.createdAt).format({short: true}), 3)} old`)
    .setTimestamp(new Date())

  sendLog(config.channel, ':inbox_tray:', 'Member Join', msg, {embed})
}

async function getInviter(guild) {
  const oldInvites = invites.get(guild.id)

  if (!oldInvites) {
    invites.set(guild.id, await guild.fetchInvites())
    return 'No Cache'
  }

  const newInvites = await guild.fetchInvites()

  const possibleInviters = newInvites.filter(i => i.uses > 0 && (!oldInvites.get(i.code) || i.uses !== oldInvites.get(i.code).uses))

  invites.set(guild.id, newInvites)

  if (!possibleInviters || possibleInviters.size === 0) {
    return null
  } else {
    return possibleInviters.map(i => `${formatUser(i.inviter, true)} {\`${i.code}\`} <\`${i.uses}\`>`).join(', ')
  }
}

const lastKicks = new Map()
module.exports.events.guildMemberRemove = async (bot, member) => {
  const config = getConfig(member.guild)
  if (!config || !config.settings.member_remove) return

  await sleep(500) // thanks audit logs

  const after = lastKicks.get(member.guild.id)
  let latestKick

  if (member.guild.me.permissions.has('VIEW_AUDIT_LOG')) {
    latestKick = (after ?
      (await member.guild.fetchAuditLogs({type: 'MEMBER_KICK', limit: 1})) :
      (await member.guild.fetchAuditLogs({type: 'MEMBER_KICK', limit: 1, after}))).entries.first()

    if (latestKick && (latestKick.target.id !== member.user.id || latestKick.id === after)) {
      latestKick = null
    }

    lastKicks.set(member.guild.id, latestKick ? latestKick.id : undefined)
  }

  const msg = `${formatUser(member.user)} ${member}`
            + (latestKick ? ` kicked by ${formatUser(latestKick.executor)} ${latestKick.reason ? 'for "' + latestKick.reason + '"': ''}` : '')

  const roles = (config.settings.member_remove_roles ? member.roles.map(r => r.name).filter(r => r !== '@everyone').join(', ') : '')
  const embed = new Discord.RichEmbed()

  embed.setDescription(`**${member.guild.memberCount}** Members\n${roles ? '**Roles:** ' + roles : ''}`)
    .setColor(colors.memberRemove)
    .setFooter(`Joined ${Time.trim(Time.since(member.joinedAt).format({short: true}), 3)} ago`)
    .setTimestamp(new Date())

  sendLog(config.channel, latestKick ? ':boot:' : ':outbox_tray:', 'Member Remove', msg, {embed})
}

const lastBans = new Map()
const numBans = new Map()
module.exports.events.guildBanAdd = async (bot, guild, user) => {
  const config = getConfig(guild)
  if (!config || !config.settings.user_ban) return

  await sleep(500) // thanks audit logs

  const after = lastBans.get(guild.id)
  let latestBan

  if (guild.me.permissions.has('VIEW_AUDIT_LOG')) {
    latestBan =
      (await guild.fetchAuditLogs({type: 'MEMBER_BAN_ADD', limit: 1, after})).entries.first()

    if (latestBan && (latestBan.target.id !== user.id || latestBan.id === after)) {
      latestBan = null
    }

    lastBans.set(guild.id, latestBan ? latestBan.id : undefined)
  }

  const msg = `${formatUser(user)} ${user}`
            + (latestBan ? ` banned by ${formatUser(latestBan.executor)} ${latestBan.reason ? 'for "' + latestBan.reason + '"': ''}` : '')

  const embed = new Discord.RichEmbed()
  const nBans = (numBans.get(guild.id) + 1) || (await guild.fetchBans()).size
  numBans.set(guild.id, nBans)

  embed.setDescription(`**${nBans}** Bans`)
    .setColor(colors.userBan)
    .setTimestamp(new Date())

  sendLog(config.channel, ':hammer:', 'User Ban', msg, {embed})
}

const lastUnbans = new Map()
module.exports.events.guildBanRemove = async (bot, guild, user) => {
  const config = getConfig(guild)
  if (!config || !config.settings.user_unban) return

  await sleep(500) // thanks audit logs

  const after = lastUnbans.get(guild.id)
  let latestUnban

  if (guild.me.permissions.has('VIEW_AUDIT_LOG')) {
    latestUnban =
      (await guild.fetchAuditLogs({type: 'MEMBER_BAN_REMOVE', limit: 1, after})).entries.first()

    if (latestUnban && (latestUnban.target.id !== user.id || latestUnban.id === after)) {
      latestUnban = null
    }

    lastUnbans.set(guild.id, latestUnban ? latestUnban.id : undefined)
  }

  const msg = `${formatUser(user)} ${user}`
            + (latestUnban ? ` unbanned by ${formatUser(latestUnban.executor)} ${latestUnban.reason ? 'for "' + latestUnban.reason + '"': ''}` : '')

  const embed = new Discord.RichEmbed()
  const nBans = (numBans.get(guild.id) - 1) || (await guild.fetchBans()).size
  numBans.set(guild.id, nBans)

  embed.setDescription(`**${nBans}** Bans`)
    .setColor(colors.userUnban)
    .setTimestamp(new Date())

  sendLog(config.channel, ':shield:', 'User Unban', msg, {embed})
}

// Since this isn't called for a specific guild, we need to check each one we're in :(
module.exports.events.userUpdate = async (bot, oldUser, newUser) => {
  let msgUser, msgAvy, msgBoth

  if (oldUser.tag !== newUser.tag)
    msgUser = msgBoth = `${formatUser(oldUser)} => ${formatUser(newUser, false)}`

  if (oldUser.avatarURL !== newUser.avatarURL) {
    msgAvy = `${formatUser(newUser)} => <${newUser.avatarURL}>`
    msgBoth = msgBoth ? msgBoth + ` <${newUser.avatarURL}>` : msgAvy
  }

  for (let guild of bot.guilds.array()) {
    const config = getConfig(guild)
    if (!config || !config.settings.user_update) return
    if (!(await userInGuild(guild, newUser))) return

    let msg

    if (config.settings.user_update === 'username' && msgUser) {
      msg = msgUser
    } else if (config.settings.user_update === 'avatar' && msgAvy) {
      msg = msgAvy
    } else if (config.settings.user_update === 'both' && msgBoth) {
      msg = msgBoth
    }

    if (msg)
      sendLog(config.channel, ':busts_in_silhouette:', 'User Update', msg)
  }
}

module.exports.events.messageDeleteBulk = async (bot, messages) => {
  const firstMsg = messages.first()
  const guild = firstMsg.guild

  const config = getConfig(guild)
  if (!config || !config.settings.delete_bulk) return

  const msgsSorted = messages.array().sort((a, b) => a.createdTimestamp - b.createdTimestamp)
  const users = new Set(messages.array().map(m => m.author))
  const messagesPerUser = new Map()

  let txt = `[${firstMsg.guild.name} (${firstMsg.guild.id}); #${firstMsg.channel.name} (${firstMsg.channel.id})]\n`
          + `[${Array.from(users).map(u => u.tag + ' (' + u.id + ')').join('; ')}]\n\n`

  for (const msg of msgsSorted) {
    txt += messageToLog(msg) + '\n'

    const newCount = (messagesPerUser.get(msg.author.id) || 0) + 1
    messagesPerUser.set(msg.author.id, newCount)
  }

  const userList = Array.from(users).map(u => formatUser(u, false) + `\`[${messagesPerUser.get(u.id)}]\``).join(', ').substring(0, 200)
  const filename = `${firstMsg.channel.name}.dlog.txt`
  const gist = await bot.sleet.createGist(txt, {filename})
  const msg = `${firstMsg.channel}, ${messages.size} messages\n${userList}\n<${gist.body.html_url}>`

  sendLog(config.channel, ':bomb:', 'Channel Purged', msg)
}

const lastDeleteEntry = new Map()
module.exports.events.messageDelete = async (bot, message) => {
  const config = getConfig(message.guild)
  if (!config || !config.settings.message_delete) return

  const delLog = message.edits.reverse().map(m => messageToLog(m, {username: false, id: false})).join('\n')
  const after = lastDeleteEntry.get(message.guild.id)
  let executor, reason

  if (message.guild.me.hasPermission('VIEW_AUDIT_LOG')) {
    const lastDel = (after ?
      (await message.guild.fetchAuditLogs({type: 'MESSAGE_DELETE', limit: 1})) :
      (await message.guild.fetchAuditLogs({type: 'MESSAGE_DELETE', limit: 1, after}))).entries.first()

    if (lastDel && lastDel.target.id === message.author.id && lastDel.id !== after) {
      ({executor, reason} = lastDel)
    }

    lastDeleteEntry.set(message.guild.id, lastDel.id)
  }


  const msg = `(${message.id}) from ${formatUser(message.author)} in ${message.channel}`
          + (executor ? ` by ${formatUser(executor)}` : '')
          + (reason ? ` for "${reason}"` : '')
          + (message.edits.length > 1 ? `, **${message.edits.length}** revisions` : '')
          + '\n'
          + '```\n' + delLog.replace(/(`{3})/g, '`\u{200B}'.repeat(3)).substring(0, 1500) + '\n```'

  sendLog(config.channel, ':wastebasket:', 'Message Deleted', msg)
}

function messageToLog(message, {username = true, id = true} = {}) {
  return `[${curTime(message.editedAt || message.createdAt)}]` +
           (id ? '(' + message.id + ') ' : '') +
           `${username ? message.author.username + ' :' : ''} ${message.cleanContent}` +
           `${(message.attachments.first() !== undefined) ? ' | Attach: ' + message.attachments.array().map(a => a.url).join(', ') : ''}`
}

function curTime(date) {
  date = date || new Date()
  return `${padLeft(date.getMonth()+1,2,0)}/${padLeft(date.getDate(),2,0)} ${padLeft(date.getHours(),2,0)}:${padLeft(date.getMinutes(),2,0)}`
}

function padLeft(msg, pad, padChar = '0') {
  padChar = '' + padChar
  msg = '' + msg
  let padded = padChar.repeat(pad)
  return padded.substring(0, padded.length - msg.length) + msg
}

function sleep(time) {
  return new Promise(r => setTimeout(r, time))
}

// **Username**#discrim (id)
// \u{200e} is a left-to-right indicator
function formatUser(user, addID = true) {
  return `**${escapeMarkdown(user.username)}**\u{200e}#${user.discriminator} ${addID ? '(' + user.id + ')' : ''}`
}

function toPrim(val) {
  val += ''
  return +val || (val.toLowerCase() === 'true' ? true : null) || (val.toLowerCase() === 'false' ? false : (val.toLowerCase() === 'null' ? null : val))
}

async function userInGuild(guild, user) {
  try {
    return await guild.fetchMember(user)
  } catch (e) {
    return false
  }
}
