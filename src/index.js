const { ApolloServer, gql } = require("apollo-server");
const { MongoClient, ObjectID } = require("mongodb");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

dotenv.config();

const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

const getToken = (user) => {
	return jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "30 days" });
};

const getUserFromToken = async (token, database) => {
	if (!token) {
		return null;
	} else {
		const tokenData = jwt.verify(token, JWT_SECRET);
		if (!tokenData.id) {
			return null;
		} else {
			const user = await database
				.collection("Users")
				.findOne({ _id: ObjectID(tokenData.id) });
			return user;
		}
	}
};

const typeDefs = gql`
	type Query {
		myTaskLists: [TaskList]
		getTaskList(id: ID!): TaskList!
		getUsers(input: GetUserSearch): [User]
	}

	type Mutation {
		signUp(input: SignUpInput!): AuthenticateUser!
		signIn(input: SignInInput!): AuthenticateUser!

		createTaskList(title: String!): TaskList!
		updateTaskList(id: ID!, title: String!): TaskList!
		deleteTaskList(id: ID!): Boolean!
		addUserToTaskList(taskListId: ID!, userId: ID!): TaskList!

		createTask(content: String!, taskListId: ID!): Task!
		updateTask(id: ID!, content: String, isComplete: Boolean): Task!
		deleteTask(id: ID!): Boolean!
	}

	input SignUpInput {
		email: String!
		password: String!
		name: String!
		avatar: String
		role: String
	}

	input SignInInput {
		email: String!
		password: String!
	}

	input GetUserSearch {
		text: String
	}

	type AuthenticateUser {
		user: User!
		token: String!
	}

	type User {
		id: ID!
		name: String!
		email: String!
		avatar: String
		role: String
	}

	type TaskList {
		id: ID!
		title: String!
		progress: Float!

		users: [User!]!
		tasks: [Task!]!
	}

	type Block {
		id: ID!
		title: String!
		tasks: [Task!]!
	}

	type Task {
		id: ID!
		content: String!
		isComplete: Boolean!

		taskList: TaskList!
	}
`;

const resolvers = {
	Query: {
		myTaskLists: async (_, __, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please sign in");
			} else {
				const taskLists = await database
					.collection("TaskList")
					.find({ userIds: user._id })
					.toArray();
				return taskLists;
			}
		},

		getUsers: async (_, { input }, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please sign in");
			} else {
				if (input.text === "") {
					return [];
				} else {
					const foundUsers =
						(await database.collection("Users").find({
							email: { $regex: input.text, $options: "i" },
						})) ||
						(await database.collection("Users").find({
							name: { $regex: input.text, $options: "i" },
						}));
					return foundUsers ? foundUsers.toArray() : [];
				}
			}
		},

		getTaskList: async (_, { id }, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please log in");
			} else {
				return await database
					.collection("TaskList")
					.findOne({ _id: ObjectID(id) });
			}
		},
	},

	Mutation: {
		signUp: async (_, { input }, { database }) => {
			const hashedPassword = bcrypt.hashSync(input.password);
			const newUser = {
				...input,
				password: hashedPassword,
			};

			const result = await database
				.collection("Users")
				.insertOne(newUser);
			const user = result.ops[0];
			return {
				user,
				token: getToken(user),
			};
		},
		signIn: async (_, { input }, { database }) => {
			const user = await database
				.collection("Users")
				.findOne({ email: input.email });
			if (!user) {
				throw new Error("Invalid Credentials");
			} else {
				const isPasswordCorrect = bcrypt.compareSync(
					input.password,
					user.password
				);
				if (!isPasswordCorrect) {
					throw new Error("Invalid Credentials");
				} else {
					return {
						user,
						token: getToken(user),
					};
				}
			}
		},

		createTaskList: async (_, { title }, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please sign in");
			} else {
				const newTaskList = {
					title,
					createdAt: new Date().toISOString(),
					userIds: [user._id],
				};

				const result = await database
					.collection("TaskList")
					.insertOne(newTaskList);
				return result.ops[0];
			}
		},

		updateTaskList: async (_, { id, title }, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please log in");
			} else {
				const result = await database
					.collection("TaskList")
					.updateOne({ _id: ObjectID(id) }, { $set: { title } });
				return await database
					.collection("TaskList")
					.findOne({ _id: ObjectID(id) });
			}
		},

		deleteTaskList: async (_, { id }, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please log in");
			} else {
				await database
					.collection("TaskList")
					.removeOne({ _id: ObjectID(id) });
				return true;
			}
		},

		addUserToTaskList: async (
			_,
			{ taskListId, userId },
			{ database, user }
		) => {
			if (!user) {
				throw new Error("Authentication Error. Please log in");
			} else {
				const TaskList = await database
					.collection("TaskList")
					.findOne({ _id: ObjectID(taskListId) });
				if (!TaskList) {
					return TaskList;
				} else {
					const foundUser = TaskList.userIds.find(
						(databaseId) =>
							databaseId.toString() === userId.toString()
					);
					if (!foundUser) {
						await database.collection("TaskList").updateOne(
							{ _id: ObjectID(taskListId) },
							{
								$push: {
									userIds: ObjectID(userId),
								},
							}
						);
						TaskList.userIds.push(ObjectID(userId));
						return TaskList;
					} else {
						return TaskList;
					}
				}
			}
		},

		createTask: async (_, { content, taskListId }, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please sign in");
			} else {
				const newTask = {
					content,
					taskListId: ObjectID(taskListId),
					isComplete: false,
				};

				const result = await database
					.collection("Task")
					.insertOne(newTask);
				return result.ops[0];
			}
		},

		updateTask: async (_, data, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please log in");
			} else {
				const result = await database
					.collection("Task")
					.updateOne({ _id: ObjectID(data.id) }, { $set: data });
				return await database
					.collection("Task")
					.findOne({ _id: ObjectID(data.id) });
			}
		},

		deleteTask: async (_, task, { database, user }) => {
			if (!user) {
				throw new Error("Authentication Error. Please log in");
			} else {
				await database
					.collection("Task")
					.removeOne({ _id: ObjectID(task.id) });
				return true;
			}
		},
	},

	User: {
		id: ({ _id, id }) => _id || id,
	},

	TaskList: {
		id: ({ _id, id }) => _id || id,
		progress: async ({ _id }, _, { database }) => {
			const tasks = await database
				.collection("Task")
				.find({ taskListId: ObjectID(_id) })
				.toArray();
			const completed = tasks.filter((task) => task.isComplete);
			if (tasks.length === 0) {
				return 0;
			} else {
				return 100 * (completed.length / tasks.length);
			}
		},
		users: async ({ userIds }, _, { database }) =>
			Promise.all(
				userIds.map((userId) =>
					database.collection("Users").findOne({ _id: userId })
				)
			),
		tasks: async ({ _id }, _, { database }) =>
			await database
				.collection("Task")
				.find({ taskListId: ObjectID(_id) })
				.toArray(),
	},

	Task: {
		id: ({ _id, id }) => _id || id,
		taskList: async ({ taskListId }, _, { database }) =>
			await database
				.collection("TaskList")
				.findOne({ _id: ObjectID(taskListId) }),
	},
};

const start = async () => {
	const client = new MongoClient(DB_URI, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
	});
	await client.connect();
	const database = client.db(DB_NAME);

	const context = {
		database,
	};

	const server = new ApolloServer({
		typeDefs,
		resolvers,
		context: async ({ req }) => {
			const user = await getUserFromToken(
				req.headers.authorization,
				database
			);
			return {
				database,
				user,
			};
		},
	});

	server.listen().then(({ url }) => {
		console.log(`🚀  Server ready at ${url}`);
	});
};

start();
